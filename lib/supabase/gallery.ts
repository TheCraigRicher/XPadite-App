import { createClient } from '@/lib/supabase/client'
import type { GalleryItem } from '@/components/xpadite/GalleryModal'

type Supabase = ReturnType<typeof createClient>

const BUCKET = 'gallery'

function dataUriToBlob(dataUri: string): Blob {
  const [header, b64] = dataUri.split(',')
  const mime = header.match(/:(.*?);/)?.[1] ?? 'image/jpeg'
  const binary = atob(b64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return new Blob([bytes], { type: mime })
}

export async function uploadGalleryImage(
  supabase: Supabase,
  userId: string,
  itemId: string,
  dataUri: string,
): Promise<string | null> {
  const blob = dataUriToBlob(dataUri)
  const path = `gallery/${userId}/${itemId}.jpg`
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(path, blob, { contentType: 'image/jpeg', upsert: true })
  if (error) { console.error('[Gallery] Storage upload error:', error); return null }
  return path
}

export async function upsertGalleryItemMetadata(
  supabase: Supabase,
  userId: string,
  item: GalleryItem,
  storagePath: string | null,
): Promise<void> {
  const { error } = await supabase.from('gallery_items').upsert(
    {
      user_id: userId,
      item_id: item.id,
      type: item.type,
      title: item.title,
      storage_path: storagePath,
      created_at: new Date(item.createdAt).toISOString(),
      month: item.month ?? null,
      year: item.year ?? null,
      stats: item.stats ?? null,
    },
    { onConflict: 'user_id,item_id' },
  )
  if (error) throw error
}

export async function deleteGalleryItem(
  supabase: Supabase,
  userId: string,
  itemId: string,
): Promise<void> {
  const path = `gallery/${userId}/${itemId}.jpg`
  await supabase.storage.from(BUCKET).remove([path]).catch(() => {})
  const { error } = await supabase
    .from('gallery_items')
    .delete()
    .eq('user_id', userId)
    .eq('item_id', itemId)
  if (error) throw error
}

export interface GalleryItemRow {
  itemId: string
  type: string
  title: string
  storagePath: string | null
  month: number | null
  year: number | null
  stats: GalleryItem['stats'] | null
  createdAt: number
}

export async function fetchGalleryItems(
  supabase: Supabase,
  userId: string,
): Promise<GalleryItemRow[]> {
  const { data, error } = await supabase
    .from('gallery_items')
    .select('item_id, type, title, storage_path, month, year, stats, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
  if (error || !data) return []
  return data.map(row => ({
    itemId: row.item_id as string,
    type: row.type as string,
    title: row.title as string,
    storagePath: (row.storage_path as string | null) ?? null,
    month: (row.month as number | null) ?? null,
    year: (row.year as number | null) ?? null,
    stats: (row.stats as GalleryItem['stats'] | null) ?? null,
    createdAt: new Date(row.created_at as string).getTime(),
  }))
}

export async function getSignedUrl(
  supabase: Supabase,
  storagePath: string,
  expiresIn = 3600,
): Promise<string | null> {
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(storagePath, expiresIn)
  if (error || !data) return null
  return data.signedUrl
}
