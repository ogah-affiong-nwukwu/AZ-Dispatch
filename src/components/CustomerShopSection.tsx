import { useEffect, useState } from 'react'
import type { Address, BusinessProfile, ShopItem, User } from '../types'
import { AZ_HUB } from '../data/defaults'
import { mockGeocode } from '../utils/geo'
import {
  fetchShopItemsForBusiness,
  placeShopOrder,
} from '../services/orders'
import { fetchCustomerProfile, saveCustomerProfile } from '../services/auth'
import { formatNgn } from '../utils/format'
import { IconPackage, IconPlus, IconSearch, IconX } from './Icons'
import './../styles/customer.css'
import './../styles/flow.css'

interface CustomerShopSectionProps {
  user: User
  business: BusinessProfile
  onOrderPlaced: (orderId: string | null) => void
  notify: (text: string, tone?: 'success' | 'error' | 'info') => void
}

interface CartLine {
  item: ShopItem
  quantity: number
}

interface CheckoutForm {
  label: string
  line1: string
  city: string
  state: string
  phone: string
}

export function CustomerShopSection({
  user,
  business,
  onOrderPlaced,
  notify,
}: CustomerShopSectionProps) {
  const [items, setItems] = useState<ShopItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [cart, setCart] = useState<CartLine[]>([])
  const [checkoutOpen, setCheckoutOpen] = useState(false)
  const [checkout, setCheckout] = useState<CheckoutForm>({
    label: '',
    line1: '',
    city: '',
    state: '',
    phone: '',
  })
  const [placing, setPlacing] = useState(false)
  const [placeErrors, setPlaceErrors] = useState<string[]>([])

  useEffect(() => {
    let active = true
    setLoading(true)
    fetchShopItemsForBusiness(business.userId)
      .then((list) => {
        if (!active) return
        setItems(list)
        setLoading(false)
      })
      .catch(() => {
        if (!active) return
        setError('Could not load the products.')
        setLoading(false)
      })
    fetchCustomerProfile(user.id)
      .then((profile) => {
        if (!active || !profile) return
        setCheckout((current) => ({
          ...current,
          label: profile.defaultAddress?.label ?? current.label,
          line1: profile.defaultAddress?.line1 ?? current.line1,
          city: profile.defaultAddress?.city ?? current.city,
          state: profile.defaultAddress?.state ?? current.state,
          phone: profile.phone ?? current.phone,
        }))
      })
      .catch(() => {
        if (!active) return
        console.warn('[shop] could not load the customer profile')
      })
    return () => {
      active = false
    }
  }, [user.id, business.userId])

  const filteredItems = items.filter((item) => {
    const query = search.trim().toLowerCase()
    if (!query) return true
    return (
      item.name.toLowerCase().includes(query) ||
      item.description.toLowerCase().includes(query)
    )
  })

  const addToCart = (item: ShopItem) => {
    setCheckoutOpen(false)
    setCart((current) => {
      const existing = current.find((line) => line.item.id === item.id)
      if (existing) {
        if (existing.quantity >= item.quantity) return current
        return current.map((line) =>
          line.item.id === item.id
            ? { ...line, quantity: line.quantity + 1 }
            : line,
        )
      }
      return [...current, { item, quantity: 1 }]
    })
  }

  const changeQuantity = (itemId: string, delta: number) => {
    setCart((current) =>
      current
        .map((line) =>
          line.item.id === itemId
            ? { ...line, quantity: Math.max(0, line.quantity + delta) }
            : line,
        )
        .filter((line) => line.quantity > 0),
    )
  }

  const removeFromCart = (itemId: string) => {
    setCart((current) => current.filter((line) => line.item.id !== itemId))
  }

  const itemTotal = cart.reduce(
    (sum, line) => sum + line.item.priceNaira * line.quantity,
    0,
  )

  const setCheckoutField = (key: keyof CheckoutForm, value: string) => {
    setCheckout((current) => ({ ...current, [key]: value }))
  }

  const handlePlaceOrder = async () => {
    const issues: string[] = []
    if (cart.length === 0) issues.push('Your cart is empty.')
    if (!checkout.line1.trim()) issues.push('Enter your house address.')
    if (!checkout.city.trim()) issues.push('City is required.')
    if (!checkout.phone.trim()) issues.push('Enter your phone number.')
    setPlaceErrors(issues)
    if (issues.length > 0) return

    const coordinates = mockGeocode(
      `${checkout.line1} ${checkout.city}`,
      AZ_HUB.coordinates,
    )
    const deliveryAddress: Address = {
      label: checkout.label.trim() || 'Home',
      line1: checkout.line1.trim(),
      city: checkout.city.trim(),
      state: checkout.state.trim(),
      coordinates,
    }

    await saveCustomerProfile(user.id, {
      phone: checkout.phone.trim(),
      defaultAddress: deliveryAddress,
    })

    setPlacing(true)
    const result = await placeShopOrder({
      items: cart.map((line) => ({
        itemId: line.item.id,
        quantity: line.quantity,
      })),
      deliveryAddress,
      recipientName: user.fullName,
      recipientPhone: checkout.phone.trim(),
    })
    setPlacing(false)
    if (result.error) {
      setPlaceErrors([result.error])
      return
    }
    setCart([])
    setCheckoutOpen(false)
    setPlaceErrors([])
    notify('Order placed — now order a rider for it.')
    onOrderPlaced(result.orderId ?? null)
  }

  return (
    <section className="section">
      <div className="section-head">
        <h2>Marketplace</h2>
        <p>Products from {business.businessName}</p>
      </div>

      <div className="card business-banner">
        <div className="business-banner__body">
          <strong>{business.businessName}</strong>
          <span>
            {business.businessAddress ?? 'Address not set'}
            {business.businessPhone ? ` · ${business.businessPhone}` : ''}
          </span>
        </div>
      </div>

      <div className="marketplace-controls">
        <div className="input-with-icon marketplace-search">
          <IconSearch size={16} className="input-leading-icon" />
          <input
            className="input"
            placeholder={`Search ${business.businessName} products…`}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            aria-label="Search products"
          />
        </div>
      </div>

      {loading ? (
        <div className="card empty-state">
          <span className="spinner" aria-hidden="true" />
          <p>Loading products…</p>
        </div>
      ) : error ? (
        <div className="auth__error">{error}</div>
      ) : filteredItems.length === 0 ? (
        <div className="card empty-state">
          <IconPackage size={26} />
          <p>
            {items.length === 0
              ? 'This business has no products available yet.'
              : 'No products match your search.'}
          </p>
        </div>
      ) : (
        <div className="shop-layout">
          <div className="shop-grid">
            {filteredItems.map((item) => (
              <div className="card shop-item-card" key={item.id}>
                <div className="shop-item-card__media">
                  {item.images[0]?.url ? (
                    <img src={item.images[0].url} alt={item.name} />
                  ) : null}
                </div>
                <div className="shop-item-card__body">
                  <span className="chip">{item.businessName}</span>
                  <h3>{item.name}</h3>
                  {item.description && (
                    <p className="shop-item-card__desc">{item.description}</p>
                  )}
                  <div className="shop-item-card__meta">
                    <span className="shop-item-card__price">
                      {formatNgn(item.priceNaira)}
                      <small> · {item.quantity} left</small>
                    </span>
                    <button
                      type="button"
                      className="btn btn--primary btn--sm"
                      onClick={() => addToCart(item)}
                    >
                      <IconPlus size={15} />
                      Add to cart
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>

          <aside className="shop-cart card">
            <div className="shop-cart__head">
              <h3>Your cart</h3>
              {cart.length > 0 && (
                <span className="badge badge--info">{cart.length}</span>
              )}
            </div>

            {cart.length === 0 ? (
              <p className="shop-cart__empty">
                Add products from {business.businessName} to start an order.
              </p>
            ) : (
              <>
                {cart.map((line) => (
                  <div className="cart-line" key={line.item.id}>
                    <span className="cart-line__name">
                      <strong>{line.item.name}</strong>
                      <small>{formatNgn(line.item.priceNaira)}</small>
                    </span>
                    <span className="cart-line__qty">
                      <button
                        type="button"
                        className="qty-btn"
                        onClick={() => changeQuantity(line.item.id, -1)}
                        aria-label="Decrease quantity"
                      >
                        −
                      </button>
                      <strong>{line.quantity}</strong>
                      <button
                        type="button"
                        className="qty-btn"
                        onClick={() => changeQuantity(line.item.id, 1)}
                        disabled={line.quantity >= line.item.quantity}
                        aria-label="Increase quantity"
                      >
                        +
                      </button>
                    </span>
                    <span className="cart-line__total">
                      {formatNgn(line.item.priceNaira * line.quantity)}
                    </span>
                    <button
                      type="button"
                      className="cart-line__remove"
                      onClick={() => removeFromCart(line.item.id)}
                      aria-label="Remove item"
                    >
                      <IconX size={14} />
                    </button>
                  </div>
                ))}

                <div className="cart-totals">
                  <span className="cart-totals__grand">
                    Total <strong>{formatNgn(itemTotal)}</strong>
                  </span>
                </div>

                {checkoutOpen ? (
                  <div className="checkout-form">
                    <div className="form-grid">
                      <div className="field">
                        <label className="label" htmlFor="shop-line1">
                          House address
                        </label>
                        <input
                          id="shop-line1"
                          className="input"
                          placeholder="House number and street"
                          value={checkout.line1}
                          onChange={(event) =>
                            setCheckoutField('line1', event.target.value)
                          }
                        />
                      </div>
                      <div className="field">
                        <label className="label" htmlFor="shop-city">
                          City
                        </label>
                        <input
                          id="shop-city"
                          className="input"
                          value={checkout.city}
                          onChange={(event) =>
                            setCheckoutField('city', event.target.value)
                          }
                        />
                      </div>
                      <div className="field">
                        <label className="label" htmlFor="shop-phone">
                          Phone number
                        </label>
                        <input
                          id="shop-phone"
                          className="input"
                          inputMode="tel"
                          value={checkout.phone}
                          onChange={(event) =>
                            setCheckoutField('phone', event.target.value)
                          }
                        />
                      </div>
                      <div className="field">
                        <label className="label" htmlFor="shop-label">
                          Address label
                        </label>
                        <input
                          id="shop-label"
                          className="input"
                          placeholder="e.g. Home, Work"
                          value={checkout.label}
                          onChange={(event) =>
                            setCheckoutField('label', event.target.value)
                          }
                        />
                      </div>
                    </div>
                    {placeErrors.length > 0 && (
                      <div className="auth__error">{placeErrors.join(' ')}</div>
                    )}
                    <button
                      type="button"
                      className="btn btn--primary btn--block"
                      disabled={placing}
                      onClick={handlePlaceOrder}
                    >
                      {placing ? 'Placing order…' : 'Place order'}
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    className="btn btn--primary btn--block"
                    onClick={() => setCheckoutOpen(true)}
                  >
                    Checkout
                  </button>
                )}
              </>
            )}
          </aside>
        </div>
      )}
    </section>
  )
}
