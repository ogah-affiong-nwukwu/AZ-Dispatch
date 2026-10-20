import { requireSupabase } from '../lib/supabase'
import type { Item, ItemImage, ItemInput } from '../types'
import { localDateString } from '../utils/format'

interface ItemRow {
  id: string
  business_user_id: string
  company_id: string
  name: string
  description: string
  price_naira: number
  quantity: number
  is_available: boolean
  listed_on: string
  created_at: string
  updated_at: string
}

interface ItemImageRow {
  id: string
  item_id: string
  storage_path: string
  position: number
  created_at: string
}

export const MAX_ITEM_PHOTOS = 4
export const MAX_PHOTO_BYTES = 2 * 1024 * 1024
const ALLOWED_PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp']

export function validatePhotoFile(file: File): string | null {
  if (!ALLOWED_PHOTO_TYPES.includes(file.type)) {
    return 'Photos must be JPG, PNG or WebP images.'
  }
  if (file.size > MAX_PHOTO_BYTES) {
    return 'Each photo must be 2 MB or smaller.'
  }
  return null
}

export function mapImage(row: ItemImageRow): ItemImage {
  const supabase = requireSupabase()
  return {
    id: row.id,
    itemId: row.item_id,
    storagePath: row.storage_path,
    position: row.position,
    createdAt: row.created_at,
    url: supabase.storage.from('item-images').getPublicUrl(row.storage_path)
      .data.publicUrl,
  }
}

export function mapItem(row: ItemRow): Item {
  return {
    id: row.id,
    businessUserId: row.business_user_id,
    companyId: row.company_id,
    name: row.name,
    description: row.description,
    priceNaira: row.price_naira,
    quantity: row.quantity,
    isAvailable: row.is_available,
    listedOn: row.listed_on,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    images: [],
  }
}

export async function fetchBusinessItems(
  businessUserId: string,
): Promise<Item[]> {
  const supabase = requireSupabase()
  const { data: rows, error } = await supabase
    .from('items')
    .select('*')
    .eq('business_user_id', businessUserId)
    .order('created_at', { ascending: false })
  if (error || !rows) return []
  const items = (rows as ItemRow[]).map(mapItem)
  const itemIds = items.map((item) => item.id)
  if (itemIds.length === 0) return items
  const { data: imageRows } = await supabase
    .from('item_images')
    .select('*')
    .in('item_id', itemIds)
    .order('position', { ascending: true })
  if (imageRows) {
    const images = (imageRows as ItemImageRow[]).map(mapImage)
    for (const item of items) {
      item.images = images.filter((image) => image.itemId === item.id)
    }
  }
  return items
}

function buildPath(userId: string, itemId: string, position: number, file: File) {
  const extension = file.name.split('.').pop()?.toLowerCase() || 'jpg'
  return `${userId}/${itemId}/photo-${position}.${extension}`
}

async function resolveOwnerId(
  context: string,
  fallbackUserId: string,
): Promise<string> {
  const supabase = requireSupabase()
  const { data: authData } = await supabase.auth.getUser()
  const signedInId = authData?.user?.id ?? null
  console.log(`[items] ${context} — supabase.auth.getUser():`, {
    id: signedInId,
    email: authData?.user?.email ?? null,
  })
  if (signedInId && signedInId !== fallbackUserId) {
    console.warn(
      `[items] ${context} — caller id differs from the signed-in user id; using the signed-in id.`,
      { callerId: fallbackUserId, signedInId },
    )
  }
  return signedInId ?? fallbackUserId
}

async function uploadPhotos(
  userId: string,
  itemId: string,
  startPosition: number,
  files: File[],
): Promise<{ error?: string; added: number }> {
  const supabase = requireSupabase()
  const ownerId = await resolveOwnerId('uploadPhotos', userId)
  for (let index = 0; index < files.length; index += 1) {
    const file = files[index]
    const position = startPosition + index
    const path = buildPath(ownerId, itemId, position, file)
    const { error: uploadError } = await supabase.storage
      .from('item-images')
      .upload(path, file, { upsert: true, contentType: file.type })
    if (uploadError) {
      return { error: uploadError.message, added: index }
    }
    const { error: rowError } = await supabase.from('item_images').insert({
      item_id: itemId,
      storage_path: path,
      position,
    })
    if (rowError) return { error: rowError.message, added: index }
  }
  return { added: files.length }
}

export async function createItem(
  businessUserId: string,
  input: ItemInput,
  files: File[],
): Promise<string | null> {
  const supabase = requireSupabase()
  const ownerId = await resolveOwnerId('createItem', businessUserId)
  const price = Number(input.priceNaira)
  const quantity = Number(input.quantity)
  const payload = {
    business_user_id: ownerId,
    company_id: null,
    name: input.name.trim(),
    description: input.description.trim(),
    price_naira: Number.isFinite(price) ? price : 0,
    quantity: Number.isFinite(quantity) ? Math.floor(quantity) : 0,
    is_available: true,
    listed_on: localDateString(),
  }
  console.log('[items] createItem — insert payload:', payload)
  const { data, error } = await supabase.from('items').insert(payload).select().single()
  if (error || !data) {
    console.error('[items] createItem — insert failed:', {
      message: error?.message ?? 'Could not create the item.',
      code: error?.code ?? null,
      details: error?.details ?? null,
      hint: error?.hint ?? null,
    })
    return error?.message ?? 'Could not create the item.'
  }
  const item = mapItem(data as ItemRow)
  if (files.length > 0) {
    const result = await uploadPhotos(ownerId, item.id, 0, files)
    if (result.error) return result.error
  }
  return null
}

export async function updateItem(
  itemId: string,
  input: ItemInput,
): Promise<string | null> {
  const supabase = requireSupabase()
  const price = Number(input.priceNaira)
  const quantity = Number(input.quantity)
  const { error } = await supabase
    .from('items')
    .update({
      name: input.name.trim(),
      description: input.description.trim(),
      price_naira: Number.isFinite(price) ? price : 0,
      quantity: Number.isFinite(quantity) ? Math.floor(quantity) : 0,
    })
    .eq('id', itemId)
  return error ? error.message : null
}

export async function setItemAvailability(
  itemId: string,
  isAvailable: boolean,
): Promise<string | null> {
  const { error } = await requireSupabase()
    .from('items')
    .update({ is_available: isAvailable })
    .eq('id', itemId)
  return error ? error.message : null
}

export async function reListItem(itemId: string): Promise<string | null> {
  const { error } = await requireSupabase()
    .from('items')
    .update({ listed_on: localDateString(), is_available: true })
    .eq('id', itemId)
  return error ? error.message : null
}

export async function deleteItem(item: Item): Promise<string | null> {
  const supabase = requireSupabase()
  const { error } = await supabase.from('items').delete().eq('id', item.id)
  if (error) return error.message
  const paths = item.images.map((image) => image.storagePath)
  if (paths.length > 0) {
    await supabase.storage.from('item-images').remove(paths)
  }
  return null
}

export async function addItemPhotos(
  userId: string,
  itemId: string,
  startPosition: number,
  files: File[],
): Promise<string | null> {
  const result = await uploadPhotos(userId, itemId, startPosition, files)
  return result.error ?? null
}

export async function removeItemPhoto(
  image: ItemImage,
): Promise<string | null> {
  const supabase = requireSupabase()
  const { error } = await supabase.from('item_images').delete().eq('id', image.id)
  if (error) return error.message
  const { error: storageError } = await supabase.storage
    .from('item-images')
    .remove([image.storagePath])
  return storageError ? storageError.message : null
}
