type CountryPattern = [pattern: RegExp, code: string];

const COUNTRY_PATTERNS: CountryPattern[] = [
  [/united states|usa|u\.s\.a\.|usmnt|uswnt/, 'US'],
  [/korea republic|south korea/, 'KR'],
  [/north korea|dpr korea/, 'KP'],
  [/cote d.?ivoire|ivory coast/, 'CI'],
  [/czech republic|czechia/, 'CZ'],
  [/north macedonia/, 'MK'],
  [/bosnia/, 'BA'],
  [/saudi arabia|saudi/, 'SA'],
  [/united arab emirates|uae/, 'AE'],
  [/hong kong/, 'HK'],
  [/new zealand/, 'NZ'],
  [/south africa/, 'ZA'],
  [/costa rica/, 'CR'],
  [/dominican republic/, 'DO'],
  [/el salvador/, 'SV'],
  [/puerto rico/, 'PR'],
  [/trinidad/, 'TT'],
  [/vietnam|viet nam|вьетнам/, 'VN'],
  [/myanmar|burma|мьянм/, 'MM'],
  [/morocco|марокк/, 'MA'],
  [/france|франц/, 'FR'],
  [/belgium|бельг/, 'BE'],
  [/norway|норвег/, 'NO'],
  [/switzerland|швейцар/, 'CH'],
  [/spain|испан/, 'ES'],
  [/colombia|колумб/, 'CO'],
  [/argentina|аргент/, 'AR'],
  [/uruguay|уругв/, 'UY'],
  [/brazil|бразил/, 'BR'],
  [/chile|чили/, 'CL'],
  [/germany|герман|немец/, 'DE'],
  [/england|scotland|wales|northern ireland|great britain|britain|англ|шотланд|уэльс/, 'GB'],
  [/italy|итал/, 'IT'],
  [/portugal|португ/, 'PT'],
  [/netherlands|holland|нидерланд|голланд/, 'NL'],
  [/denmark|дани/, 'DK'],
  [/sweden|швец/, 'SE'],
  [/finland|финлянд/, 'FI'],
  [/poland|польш/, 'PL'],
  [/croatia|хорват/, 'HR'],
  [/serbia|серб/, 'RS'],
  [/slovenia|словен/, 'SI'],
  [/slovakia|словац/, 'SK'],
  [/austria|австр/, 'AT'],
  [/turkey|turkiye|турц/, 'TR'],
  [/greece|грец/, 'GR'],
  [/romania|румын/, 'RO'],
  [/hungary|венгр/, 'HU'],
  [/ukraine|украин/, 'UA'],
  [/russia|росси/, 'RU'],
  [/ireland|ирланд/, 'IE'],
  [/japan|япон/, 'JP'],
  [/china|китай/, 'CN'],
  [/australia|австрал/, 'AU'],
  [/mexico|мексик/, 'MX'],
  [/canada|канад/, 'CA'],
  [/ecuador|эквадор/, 'EC'],
  [/peru|перу/, 'PE'],
  [/paraguay|парагв/, 'PY'],
  [/bolivia|болив/, 'BO'],
  [/venezuela|венесуэл/, 'VE'],
  [/panama|панам/, 'PA'],
  [/tunisia|тунис/, 'TN'],
  [/algeria|алжир/, 'DZ'],
  [/egypt|егип/, 'EG'],
  [/senegal|сенегал/, 'SN'],
  [/ghana|гана/, 'GH'],
  [/nigeria|нигери/, 'NG'],
  [/cameroon|камерун/, 'CM'],
  [/qatar|катар/, 'QA'],
  [/iran|иран/, 'IR'],
  [/iraq|ирак/, 'IQ'],
  [/india|инди/, 'IN'],
  [/thailand|таиланд/, 'TH'],
  [/malaysia|малайз/, 'MY'],
  [/indonesia|индонез/, 'ID'],
  [/philippines|филиппин/, 'PH'],
];

const TEAM_SUFFIXES = new Set([
  'fc',
  'sc',
  'cf',
  'u17',
  'u18',
  'u19',
  'u20',
  'u21',
  'u23',
  'women',
  'woman',
  'men',
  'team',
  'команда',
]);

export function countryCodeForTeam(name: string): string | null {
  const normalized = normalizeTeamName(name);
  const match = COUNTRY_PATTERNS.find(([pattern]) => pattern.test(normalized));
  return match?.[1] ?? null;
}

export function flagAssetForTeam(name: string): string {
  const code = countryCodeForTeam(name);
  return code ? flagUrlForCode(code) : teamInitials(name);
}

export function flagUrlForCode(code: string): string {
  return `https://flagcdn.com/w160/${code.toLowerCase()}.png`;
}

export function teamInitials(name: string): string {
  const tokens = normalizeTeamName(name)
    .split(/[^\p{L}\p{N}]+/u)
    .filter((token) => token && !TEAM_SUFFIXES.has(token));
  const source = tokens.length >= 2
    ? `${tokens[0]?.[0] ?? ''}${tokens[1]?.[0] ?? ''}`
    : (tokens[0] ?? name).slice(0, 2);
  return source.replace(/[^\p{L}\p{N}]/gu, '').toUpperCase() || 'FC';
}

function normalizeTeamName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/&/g, ' and ')
    .toLowerCase();
}
