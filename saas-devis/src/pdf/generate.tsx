import type { DocumentBundle } from '../lib/documents'
import { logoUrl } from '../lib/format'

/** Convertit une image distante en data URL PNG (SVG et WebP non gérés par react-pdf). */
async function logoAsPng(path: string | null): Promise<string | null> {
  const url = logoUrl(path)
  if (!url) return null
  try {
    const blob = await (await fetch(url)).blob()
    const bmp = await createImageBitmap(blob).catch(async () => {
      const img = new Image()
      img.src = URL.createObjectURL(blob)
      await img.decode()
      return img
    })
    const scale = Math.min(1, 600 / bmp.width)
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(bmp.width * scale)
    canvas.height = Math.round(bmp.height * scale)
    canvas.getContext('2d')!.drawImage(bmp, 0, 0, canvas.width, canvas.height)
    return canvas.toDataURL('image/png')
  } catch {
    return null
  }
}

/** Génère le PDF dans le navigateur (chargement différé de react-pdf, ~1 Mo). */
export async function renderDocumentPdf(bundle: DocumentBundle): Promise<Blob> {
  const [{ pdf }, { DocumentPdf }, logo] = await Promise.all([
    import('@react-pdf/renderer'),
    import('./DocumentPdf'),
    logoAsPng(bundle.company.logo_path),
  ])
  return pdf(<DocumentPdf bundle={bundle} logoSrc={logo} />).toBlob()
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 5000)
}

export const pdfFilename = (b: DocumentBundle) =>
  `${b.type === 'quote' ? 'Devis' : 'Facture'}-${b.doc.number ?? 'brouillon'}-${b.company.name}`.replace(/[^\w\-àâçéèêëîïôûùüÿñæœ]+/gi, '_') + '.pdf'
