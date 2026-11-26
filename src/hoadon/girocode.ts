import QRCode from 'qrcode'

/** EPC QR code ("GiroCode") so customers can pay by scanning with their banking app. */
export function girocodePayload(opts: { name: string; iban: string; bic: string; amount: number; reference: string }) {
  return [
    'BCD', '002', '1', 'SCT',
    opts.bic.replace(/\s/g, ''),
    opts.name.slice(0, 70),
    opts.iban.replace(/\s/g, ''),
    `EUR${opts.amount.toFixed(2)}`,
    '', '',
    opts.reference.slice(0, 140),
  ].join('\n')
}

export async function girocodeDataUrl(opts: Parameters<typeof girocodePayload>[0]) {
  return QRCode.toDataURL(girocodePayload(opts), { errorCorrectionLevel: 'M', margin: 0, width: 300 })
}
