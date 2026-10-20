import { useEffect, useState } from 'react'
import type { Item, ItemInput } from '../types'
import {
  MAX_ITEM_PHOTOS,
  validatePhotoFile,
} from '../services/items'
import { IconImage, IconX } from './Icons'
import './../styles/items.css'

interface ItemFormModalProps {
  item: Item | null
  onClose: () => void
  onSave: (
    input: ItemInput,
    newFiles: File[],
    removedImageIds: string[],
  ) => Promise<string | null>
}

export function ItemFormModal({ item, onClose, onSave }: ItemFormModalProps) {
  const [name, setName] = useState(item?.name ?? '')
  const [description, setDescription] = useState(item?.description ?? '')
  const [priceNaira, setPriceNaira] = useState(
    item ? String(item.priceNaira) : '',
  )
  const [quantity, setQuantity] = useState(item ? String(item.quantity) : '1')
  const [files, setFiles] = useState<File[]>([])
  const [previews, setPreviews] = useState<string[]>([])
  const [removedIds, setRemovedIds] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    return () => {
      previews.forEach((url) => URL.revokeObjectURL(url))
    }
  }, [previews])

  const existingCount = (item?.images.length ?? 0) - removedIds.length
  const totalPhotos = existingCount + files.length

  const handleFiles = (list: FileList | null) => {
    if (!list) return
    const next = Array.from(list)
    for (const file of next) {
      const problem = validatePhotoFile(file)
      if (problem) {
        setError(problem)
        return
      }
    }
    const room = MAX_ITEM_PHOTOS - totalPhotos
    if (room <= 0) {
      setError(`An item can have at most ${MAX_ITEM_PHOTOS} photos.`)
      return
    }
    const accepted = next.slice(0, room)
    setFiles((current) => [...current, ...accepted])
    setPreviews((current) => [
      ...current,
      ...accepted.map((file) => URL.createObjectURL(file)),
    ])
    setError(null)
  }

  const removeFile = (index: number) => {
    setFiles((current) => current.filter((_, i) => i !== index))
    setPreviews((current) => {
      const [removed] = current.splice(index, 1)
      if (removed) URL.revokeObjectURL(removed)
      return [...current]
    })
  }

  const removeExisting = (imageId: string) => {
    setRemovedIds((current) => [...current, imageId])
  }

  const handleSubmit = async () => {
    if (!name.trim()) {
      setError('Enter the item name.')
      return
    }
    const price = Number(priceNaira)
    if (!Number.isFinite(price) || price <= 0) {
      setError('Enter a valid price in naira.')
      return
    }
    const qty = Number(quantity)
    if (!Number.isFinite(qty) || qty < 0) {
      setError('Enter a valid quantity.')
      return
    }
    if (totalPhotos < 1) {
      setError('Add at least 1 photo.')
      return
    }
    setSaving(true)
    const saveError = await onSave(
      { name, description, priceNaira, quantity },
      files,
      removedIds,
    )
    setSaving(false)
    if (saveError) {
      setError(saveError)
    } else {
      onClose()
    }
  }

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <div className="modal-card modal-card--item">
        <div className="modal-card__head">
          <IconImage size={18} />
          <strong>{item ? 'Edit item' : 'Add item'}</strong>
          <button
            type="button"
            className="modal-close"
            onClick={onClose}
            aria-label="Close item form"
          >
            <IconX size={16} />
          </button>
        </div>

        <div className="modal-card__body">
          <div className="form-grid">
            <div className="field">
              <label className="label" htmlFor="item-name">
                Item name
              </label>
              <input
                id="item-name"
                className="input"
                placeholder="e.g. Jollof rice and chicken"
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </div>
            <div className="field">
              <label className="label" htmlFor="item-description">
                Description
              </label>
              <textarea
                id="item-description"
                className="input input--textarea"
                rows={3}
                placeholder="What is included, portion size, etc."
                value={description}
                onChange={(event) => setDescription(event.target.value)}
              />
            </div>
            <div className="field">
              <label className="label" htmlFor="item-price">
                Price (₦)
              </label>
              <input
                id="item-price"
                className="input"
                inputMode="numeric"
                placeholder="e.g. 2500"
                value={priceNaira}
                onChange={(event) =>
                  setPriceNaira(event.target.value.replace(/[^\d.]/g, ''))
                }
              />
            </div>
            <div className="field">
              <label className="label" htmlFor="item-quantity">
                Quantity available
              </label>
              <input
                id="item-quantity"
                className="input"
                inputMode="numeric"
                placeholder="e.g. 10"
                value={quantity}
                onChange={(event) =>
                  setQuantity(event.target.value.replace(/\D/g, ''))
                }
              />
            </div>
          </div>

          <div className="field">
            <span className="label">Photos ({totalPhotos}/{MAX_ITEM_PHOTOS})</span>
            <div className="photo-grid">
              {item?.images
                .filter((image) => !removedIds.includes(image.id))
                .map((image) => (
                  <span className="photo-thumb" key={image.id}>
                    {image.url && (
                      <img src={image.url} alt={item.name} />
                    )}
                    <button
                      type="button"
                      className="photo-remove"
                      onClick={() => removeExisting(image.id)}
                      aria-label="Remove photo"
                    >
                      <IconX size={14} />
                    </button>
                  </span>
                ))}
              {previews.map((url, index) => (
                <span className="photo-thumb" key={`${index}-${url.slice(-12)}`}>
                  <img src={url} alt="New item photo" />
                  <button
                    type="button"
                    className="photo-remove"
                    onClick={() => removeFile(index)}
                    aria-label="Remove photo"
                  >
                    <IconX size={14} />
                  </button>
                </span>
              ))}
              {totalPhotos < MAX_ITEM_PHOTOS && (
                <label className="photo-add">
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    multiple
                    hidden
                    onChange={(event) => handleFiles(event.target.files)}
                  />
                  <IconImage size={18} />
                  <span>Add photo</span>
                </label>
              )}
            </div>
          </div>

          {error && <div className="auth__error">{error}</div>}

          <div className="modal-card__actions">
            <button type="button" className="btn btn--ghost" onClick={onClose}>
              Cancel
            </button>
            <button
              type="button"
              className="btn btn--primary"
              onClick={handleSubmit}
              disabled={saving}
            >
              {saving
                ? 'Saving…'
                : item
                  ? 'Save changes'
                  : 'Add item'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
