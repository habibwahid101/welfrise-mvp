'use client'

import { useRouter } from 'next/navigation'
import { useRef, useState, type ChangeEvent, type FormEvent } from 'react'

type DocumentKey = 'idDocument' | 'selfie' | 'addressDocument'
type UploadStage = 'idle' | 'preparing' | 'uploading' | 'saving'
type SelectedFiles = Record<DocumentKey, File | null>

type DocumentDefinition = {
  key: DocumentKey
  label: string
  description: string
  acceptedTypes: string[]
}

const MAX_FILE_BYTES = 4_000_000
const MAX_KYC_SUBMISSION_BYTES = 4_000_000
const EMPTY_FILES: SelectedFiles = { idDocument: null, selfie: null, addressDocument: null }
const DOCUMENTS: DocumentDefinition[] = [
  {
    key: 'idDocument',
    label: 'Government-issued ID',
    description: 'Passport, national ID, or driver’s licence.',
    acceptedTypes: ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'],
  },
  {
    key: 'selfie',
    label: 'Selfie',
    description: 'A recent, clear photo of your face.',
    acceptedTypes: ['image/jpeg', 'image/png', 'image/webp'],
  },
  {
    key: 'addressDocument',
    label: 'Proof of address',
    description: 'A recent bill, statement, or official letter.',
    acceptedTypes: ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'],
  },
]

class KycUploadError extends Error {}

function formatFileSize(bytes: number) {
  if (bytes < 1_000_000) return `${Math.max(1, Math.round(bytes / 1_000))} KB`
  return `${(bytes / 1_000_000).toFixed(1)} MB`
}

function formatFileType(type: string) {
  const labels: Record<string, string> = {
    'image/jpeg': 'JPEG image',
    'image/png': 'PNG image',
    'image/webp': 'WebP image',
    'application/pdf': 'PDF document',
  }
  return labels[type] || 'Unknown file type'
}

function responseBody(request: XMLHttpRequest) {
  try {
    return JSON.parse(request.responseText) as { error?: unknown; ok?: unknown }
  } catch {
    return {}
  }
}

function uploadDocuments(
  formData: FormData,
  callbacks: { onProgress: (percentage: number | null) => void; onSaving: () => void },
) {
  return new Promise<void>((resolve, reject) => {
    const request = new XMLHttpRequest()
    request.open('POST', '/api/kyc')
    request.setRequestHeader('Accept', 'application/json')

    request.upload.addEventListener('loadstart', () => callbacks.onProgress(null))
    request.upload.addEventListener('progress', (progressEvent) => {
      const percentage = progressEvent.lengthComputable && progressEvent.total > 0
        ? Math.min(100, Math.round((progressEvent.loaded / progressEvent.total) * 100))
        : null
      callbacks.onProgress(percentage)
    })
    request.upload.addEventListener('load', callbacks.onSaving)

    request.addEventListener('load', () => {
      const result = responseBody(request)
      if (request.status >= 200 && request.status < 300 && result.ok) {
        resolve()
        return
      }
      const message = typeof result.error === 'string' && result.error.length <= 300
        ? result.error
        : 'Unable to submit KYC documents. Please review the files and try again.'
      reject(new KycUploadError(message))
    })
    request.addEventListener('error', () => reject(new KycUploadError('The secure upload could not be completed. Check your connection and try again.')))
    request.addEventListener('abort', () => reject(new KycUploadError('The secure upload was cancelled. Please try again.')))
    request.send(formData)
  })
}

export default function KycForm({ canSubmit, initialStatus }: { canSubmit: boolean; initialStatus: string }) {
  const router = useRouter()
  const busyRef = useRef(false)
  const [busy, setBusy] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [files, setFiles] = useState<SelectedFiles>(EMPTY_FILES)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [stage, setStage] = useState<UploadStage>('idle')
  const [progress, setProgress] = useState<number | null>(null)

  function selectFile(document: DocumentDefinition, event: ChangeEvent<HTMLInputElement>) {
    const inputElement = event.currentTarget
    const file = inputElement.files?.[0] || null
    setErrorMessage(null)

    if (file && !document.acceptedTypes.includes(file.type)) {
      inputElement.value = ''
      setFiles((current) => ({ ...current, [document.key]: null }))
      setErrorMessage(`${document.label}: unsupported file format. Choose a permitted JPG, PNG, WebP${document.key === 'selfie' ? '' : ', or PDF'} file.`)
      return
    }
    if (file && file.size > MAX_FILE_BYTES) {
      inputElement.value = ''
      setFiles((current) => ({ ...current, [document.key]: null }))
      setErrorMessage(`${document.label}: file exceeds the 4 MB limit.`)
      return
    }

    setFiles((current) => ({ ...current, [document.key]: file }))
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    const formElement = event.currentTarget
    event.preventDefault()
    if (busy || busyRef.current || !canSubmit) return

    busyRef.current = true
    setBusy(true)
    setErrorMessage(null)
    setStage('preparing')
    setProgress(null)

    const formData = new FormData(formElement)
    try {
      for (const document of DOCUMENTS) {
        const file = formData.get(document.key)
        if (!(file instanceof File) || file.size < 1) throw new KycUploadError(`${document.label}: select a file before submitting.`)
      }
      const selectedBytes = DOCUMENTS.reduce((total, document) => {
        const file = formData.get(document.key)
        return total + (file instanceof File ? file.size : 0)
      }, 0)
      if (selectedBytes > MAX_KYC_SUBMISSION_BYTES) {
        throw new KycUploadError('KYC documents exceed the 4 MB total limit. Choose smaller files and try again.')
      }

      await uploadDocuments(formData, {
        onProgress: (percentage) => {
          setStage('uploading')
          setProgress(percentage)
        },
        onSaving: () => {
          setProgress(100)
          setStage('saving')
        },
      })
    } catch (error) {
      setStage('idle')
      setProgress(null)
      setErrorMessage(error instanceof KycUploadError
        ? error.message
        : 'The secure upload could not be completed. Please try again.')
      busyRef.current = false
      setBusy(false)
      return
    }

    formElement.reset()
    setFiles(EMPTY_FILES)
    setSubmitted(true)
    busyRef.current = false
    setBusy(false)
    router.refresh()
  }

  if (submitted) {
    return (
      <div className="kyc-success-state" role="status" aria-live="polite">
        <span className="kyc-success-mark" aria-hidden="true">✓</span>
        <div>
          <p><strong>KYC documents submitted successfully.</strong> Your verification status is now Pending.</p>
          <p>Status: <strong>Pending</strong></p>
        </div>
      </div>
    )
  }

  const progressMessage = stage === 'preparing'
    ? 'Preparing documents…'
    : stage === 'saving'
      ? 'Saving submission…'
      : progress === null
        ? 'Uploading securely…'
        : `Uploading securely — ${progress}%`

  return (
    <form className="form kyc-form" onSubmit={submit}>
      <p className="kyc-current-status">Status: <strong>{initialStatus}</strong></p>
      <p className="small-muted">JPG, PNG, WebP, or PDF only. Maximum 4 MB total. Files are stored privately and are not previewed here.</p>
      <div className="kyc-upload-grid">
        {DOCUMENTS.map((document) => {
          const file = files[document.key]
          const summaryId = `${document.key}-summary`
          return (
            <section className="kyc-upload-card" key={document.key}>
              <div><h3>{document.label}</h3><p>{document.description}</p></div>
              <input
                className="kyc-file-input"
                id={document.key}
                name={document.key}
                type="file"
                accept={document.acceptedTypes.join(',')}
                required
                disabled={!canSubmit || busy}
                aria-describedby={summaryId}
                onChange={(event) => selectFile(document, event)}
              />
              <label className="kyc-file-action" htmlFor={document.key}>{file ? 'Replace file' : 'Choose file'}</label>
              <div className="kyc-file-summary" id={summaryId} aria-live="polite">
                {file ? (
                  <>
                    <strong>{file.name}</strong>
                    <span>{formatFileType(file.type)}</span>
                    <span>{formatFileSize(file.size)}</span>
                    <span className="kyc-ready"><span aria-hidden="true">✓</span> Ready to upload</span>
                  </>
                ) : <span>No file selected.</span>}
              </div>
            </section>
          )
        })}
      </div>
      {errorMessage ? <div className="notice error" role="alert" aria-live="assertive">{errorMessage}</div> : null}
      {stage !== 'idle' ? (
        <div className="kyc-progress" aria-live="polite" aria-atomic="true">
          <strong>{progressMessage}</strong>
          <div
            className={`kyc-progress-bar ${stage !== 'uploading' || progress === null ? 'is-indeterminate' : ''}`}
            role="progressbar"
            aria-label="KYC document upload progress"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={stage === 'uploading' && progress !== null ? progress : undefined}
          >
            {stage === 'uploading' && progress !== null ? <span style={{ width: `${progress}%` }} /> : null}
          </div>
        </div>
      ) : null}
      <button className="primary-button kyc-submit-button" disabled={!canSubmit || busy}>{busy ? 'Uploading securely…' : 'Submit KYC documents'}</button>
    </form>
  )
}
