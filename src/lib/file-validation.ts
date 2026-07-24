export const MAX_PRIVATE_DOCUMENT_BYTES = 4_000_000
export const MAX_KYC_SUBMISSION_BYTES = 4_000_000

const mimeExtensions: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'application/pdf': 'pdf',
}

function startsWith(bytes: Uint8Array, signature: number[]) {
  return signature.every((byte, index) => bytes[index] === byte)
}

export async function validatePrivateDocument(value: FormDataEntryValue | null, label: string) {
  if (!(value instanceof File) || value.size < 1) throw new Error(`${label} is required.`)
  if (value.size > MAX_PRIVATE_DOCUMENT_BYTES) throw new Error(`${label} must be no larger than 4 MB.`)
  const extension = mimeExtensions[value.type]
  if (!extension) throw new Error(`${label} must be JPG, PNG, WebP, or PDF.`)

  const bytes = new Uint8Array(await value.slice(0, 16).arrayBuffer())
  const valid = value.type === 'image/jpeg'
    ? startsWith(bytes, [0xff, 0xd8, 0xff])
    : value.type === 'image/png'
      ? startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
      : value.type === 'image/webp'
        ? startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && startsWith(bytes.slice(8), [0x57, 0x45, 0x42, 0x50])
        : startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])

  if (!valid) throw new Error(`${label} content does not match its file type.`)
  return { file: value, extension }
}

export function assertKycSubmissionSize(files: File[]) {
  const submissionBytes = files.reduce((total, file) => total + file.size, 0)
  if (submissionBytes > MAX_KYC_SUBMISSION_BYTES) {
    throw new Error('KYC documents must be no larger than 4 MB in total.')
  }
}
