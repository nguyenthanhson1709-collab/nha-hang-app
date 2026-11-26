export const COUNTRIES: [string, string][] = [
  ['DE', 'Deutschland'], ['AT', 'Österreich'], ['CH', 'Schweiz'], ['NL', 'Niederlande'], ['BE', 'Belgien'],
  ['LU', 'Luxemburg'], ['FR', 'Frankreich'], ['DK', 'Dänemark'], ['PL', 'Polen'], ['CZ', 'Tschechien'],
  ['IT', 'Italien'], ['ES', 'Spanien'], ['PT', 'Portugal'], ['SE', 'Schweden'], ['NO', 'Norwegen'],
  ['FI', 'Finnland'], ['IE', 'Irland'], ['GB', 'Vereinigtes Königreich'], ['LT', 'Litauen'], ['LV', 'Lettland'],
  ['EE', 'Estland'], ['RO', 'Rumänien'], ['BG', 'Bulgarien'], ['HU', 'Ungarn'], ['SK', 'Slowakei'],
  ['SI', 'Slowenien'], ['HR', 'Kroatien'], ['GR', 'Griechenland'], ['TR', 'Türkei'], ['US', 'USA'],
  ['VN', 'Vietnam'], ['CN', 'China'], ['JP', 'Japan'], ['KR', 'Südkorea'], ['TH', 'Thailand'], ['ID', 'Indonesien'],
]
const byCode = new Map(COUNTRIES)
export const countryName = (code?: string) => (code ? byCode.get(code) ?? code : '')
