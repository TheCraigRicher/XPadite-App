// Public review photos. The user's real avatar lives in the PRIVATE `avatars` bucket and is never exposed. When a reviewer
// consents (reviews.show_profile_photo), the server makes a small, metadata-free copy in the PUBLIC `review-photos` bucket
// and the Website shows that copy. Server-only (uses sharp).
import sharp from 'sharp'

export const REVIEW_PHOTO_BUCKET = 'review-photos'
export const AVATAR_BUCKET = 'avatars'
export const REVIEW_PHOTO_SIZE = 256
export const MAX_AVATAR_BYTES = 5 * 1024 * 1024   // matches the avatars bucket limit

/** Path of a public copy: <review uuid>/<unix ms>.webp — mirrors the CHECK constraint in migration 020. */
export function reviewPhotoPath(reviewId: string, now = Date.now()): string {
  return `${reviewId}/${now}.webp`
}

export const REVIEW_PHOTO_PATH_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[0-9]{10,16}\.webp$/

/** The avatars bucket stores `<user id>/avatar.<ext>`; anything else (legacy URLs, other users' folders) is refused. */
export function isOwnAvatarPath(path: unknown, userId: string): path is string {
  return typeof path === 'string' && path.startsWith(`${userId}/`) && !path.includes('..') && path.length < 200
}

/**
 * Square 256x256 WebP. sharp re-encodes from pixels and drops all metadata by default, so EXIF (GPS location, device,
 * timestamps) from the original upload never reaches the public copy. Throws on anything that is not a decodable image.
 */
export async function processReviewPhoto(input: Buffer): Promise<Buffer> {
  if (input.length === 0 || input.length > MAX_AVATAR_BYTES) throw new Error('avatar_size')
  return sharp(input, { failOn: 'error', limitInputPixels: 40_000_000 })
    .rotate()                                   // honour EXIF orientation BEFORE the metadata is dropped
    .resize(REVIEW_PHOTO_SIZE, REVIEW_PHOTO_SIZE, { fit: 'cover', position: 'attention' })
    .webp({ quality: 82 })
    .toBuffer()
}
