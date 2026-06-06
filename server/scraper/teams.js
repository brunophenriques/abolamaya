// WC 2026 national teams.
// soccerwayKey:  the opaque ID from the Soccerway URL /team/{slug}/{key}/
// soccerwaySlug: override only when Soccerway's slug differs from our slug
// aliases:       alternative spellings Soccerway may use for the team name

module.exports = [
  // ── GROUP A ──────────────────────────────────────────────────────────────────
  {
    slug: 'mexico', code: 'MEX', name: 'Mexico',
    aliases: ['México'],
    soccerwayKey: 'O6iHcNkd',
  },
  {
    slug: 'south-africa', code: 'RSA', name: 'South Africa',
    aliases: ['RSA'],
    soccerwayKey: 'W2ijYvlr',
  },
  {
    slug: 'korea-republic', code: 'KOR', name: 'Korea Republic',
    aliases: ['South Korea', 'Korea'],
    soccerwayKey: 'K6Gs7P6G',
    soccerwaySlug: 'south-korea',
  },
  {
    slug: 'czechia', code: 'CZE', name: 'Czechia',
    aliases: ['Czech Republic'],
    soccerwayKey: '6LHwBDGU',
    soccerwaySlug: 'czech-republic',
  },

  // ── GROUP B ──────────────────────────────────────────────────────────────────
  {
    slug: 'canada', code: 'CAN', name: 'Canada',
    aliases: [],
    soccerwayKey: 'x4toKORL',
  },
  {
    slug: 'bosnia-and-herzegovina', code: 'BIH', name: 'Bosnia and Herzegovina',
    aliases: ['Bosnia', 'Bosnia & Herzegovina', 'Bosnia-Herzegovina'],
    soccerwayKey: 'fqe7WYTr',
    soccerwaySlug: 'bosnia-herzegovina',
  },
  {
    slug: 'qatar', code: 'QAT', name: 'Qatar',
    aliases: [],
    soccerwayKey: 'zqzHL77i',
  },
  {
    slug: 'switzerland', code: 'SUI', name: 'Switzerland',
    aliases: ['Schweiz', 'Suisse'],
    soccerwayKey: 'rHJ2vy1B',
  },

  // ── GROUP C ──────────────────────────────────────────────────────────────────
  {
    slug: 'brazil', code: 'BRA', name: 'Brazil',
    aliases: ['Brasil'],
    soccerwayKey: 'I9l9aqLq',
  },
  {
    slug: 'morocco', code: 'MAR', name: 'Morocco',
    aliases: ['Maroc'],
    soccerwayKey: 'IDKYO3R8',
  },
  {
    slug: 'haiti', code: 'HAI', name: 'Haiti',
    aliases: [],
    soccerwayKey: 'nk4v10Z1',
  },
  {
    slug: 'scotland', code: 'SCO', name: 'Scotland',
    aliases: [],
    soccerwayKey: 'fZRU25WH',
  },

  // ── GROUP D ──────────────────────────────────────────────────────────────────
  {
    slug: 'usa', code: 'USA', name: 'USA',
    aliases: ['United States', 'United States of America'],
    soccerwayKey: 'fuitL4CF',
    soccerwaySlug: 'united-states',
    resultsUrl: 'https://www.soccerway.com/team/usa/fuitL4CF/',
    squadUrl:   'https://www.soccerway.com/team/usa/fuitL4CF/squad/',
  },
  {
    slug: 'paraguay', code: 'PAR', name: 'Paraguay',
    aliases: [],
    soccerwayKey: 'YaNlqp6j',
  },
  {
    slug: 'australia', code: 'AUS', name: 'Australia',
    aliases: ['Socceroos'],
    soccerwayKey: 'xSrf6qMM',
  },
  {
    slug: 'turkiye', code: 'TUR', name: 'Türkiye',
    aliases: ['Turkey', 'Turkiye'],
    soccerwayKey: 'QeijuHo5',
    soccerwaySlug: 'turkey',
  },

  // ── GROUP E ──────────────────────────────────────────────────────────────────
  {
    slug: 'germany', code: 'GER', name: 'Germany',
    aliases: ['Deutschland'],
    soccerwayKey: 'ptQide1O',
  },
  {
    slug: 'curacao', code: 'CUR', name: 'Curaçao',
    aliases: ['Curacao'],
    soccerwayKey: 'bLLGpOkQ',
  },
  {
    slug: 'cote-divoire', code: 'CIV', name: "Côte d'Ivoire",
    aliases: ['Ivory Coast', "Cote d'Ivoire", 'Cote dIvoire'],
    soccerwayKey: 'G2FRjBgn',
    soccerwaySlug: 'ivory-coast',
  },
  {
    slug: 'ecuador', code: 'ECU', name: 'Ecuador',
    aliases: [],
    soccerwayKey: '8tbm8Tri',
  },

  // ── GROUP F ──────────────────────────────────────────────────────────────────
  {
    slug: 'netherlands', code: 'NED', name: 'Netherlands',
    aliases: ['Holland', 'Nederland'],
    soccerwayKey: 'WYintcWb',
  },
  {
    slug: 'japan', code: 'JPN', name: 'Japan',
    aliases: [],
    soccerwayKey: 'ULXPdOUj',
  },
  {
    slug: 'sweden', code: 'SWE', name: 'Sweden',
    aliases: ['Sverige'],
    soccerwayKey: 'OQyqbHWB',
  },
  {
    slug: 'tunisia', code: 'TUN', name: 'Tunisia',
    aliases: ['Tunisie'],
    soccerwayKey: 'QqZVYk95',
  },

  // ── GROUP G ──────────────────────────────────────────────────────────────────
  {
    slug: 'belgium', code: 'BEL', name: 'Belgium',
    aliases: ['Belgique', 'Belgie'],
    soccerwayKey: 'GbB957na',
  },
  {
    slug: 'egypt', code: 'EGY', name: 'Egypt',
    aliases: [],
    soccerwayKey: 'bejDn7NN',
  },
  {
    slug: 'ir-iran', code: 'IRI', name: 'IR Iran',
    aliases: ['Iran'],
    soccerwayKey: 'xrRx85iA',
    soccerwaySlug: 'iran',
  },
  {
    slug: 'new-zealand', code: 'NZL', name: 'New Zealand',
    aliases: ['All Whites'],
    soccerwayKey: 'rLctHkpU',
  },

  // ── GROUP H ──────────────────────────────────────────────────────────────────
  {
    slug: 'spain', code: 'ESP', name: 'Spain',
    aliases: ['España', 'Espana'],
    soccerwayKey: 'bLyo6mco',
  },
  {
    slug: 'cabo-verde', code: 'CPV', name: 'Cabo Verde',
    aliases: ['Cape Verde'],
    soccerwayKey: 'MocyWdm7',
    soccerwaySlug: 'cape-verde',
  },
  {
    slug: 'saudi-arabia', code: 'KSA', name: 'Saudi Arabia',
    aliases: ['Saudi'],
    soccerwayKey: 'biSY8ox4',
  },
  {
    slug: 'uruguay', code: 'URU', name: 'Uruguay',
    aliases: [],
    soccerwayKey: 'xMk44orG',
  },

  // ── GROUP I ──────────────────────────────────────────────────────────────────
  {
    slug: 'france', code: 'FRA', name: 'France',
    aliases: [],
    soccerwayKey: 'QkGeVG1n',
  },
  {
    slug: 'senegal', code: 'SEN', name: 'Senegal',
    aliases: [],
    soccerwayKey: 'hOIsJLJr',
  },
  {
    slug: 'iraq', code: 'IRQ', name: 'Iraq',
    aliases: [],
    soccerwayKey: 'K8aAGt6r',
  },
  {
    slug: 'norway', code: 'NOR', name: 'Norway',
    aliases: ['Norge'],
    soccerwayKey: '8rP6JO0H',
  },

  // ── GROUP J ──────────────────────────────────────────────────────────────────
  {
    slug: 'argentina', code: 'ARG', name: 'Argentina',
    aliases: [],
    soccerwayKey: 'f9OppQjp',
  },
  {
    slug: 'algeria', code: 'ALG', name: 'Algeria',
    aliases: ['Algérie', 'Algerie'],
    soccerwayKey: 'nc87N1BR',
  },
  {
    slug: 'austria', code: 'AUT', name: 'Austria',
    aliases: ['Österreich', 'Osterreich'],
    soccerwayKey: 'naHiWdnt',
  },
  {
    slug: 'jordan', code: 'JOR', name: 'Jordan',
    aliases: [],
    soccerwayKey: 'vNcmJoU2',
  },

  // ── GROUP K ──────────────────────────────────────────────────────────────────
  {
    slug: 'portugal', code: 'POR', name: 'Portugal',
    aliases: [],
    soccerwayKey: 'WvJrjFVN',
  },
  {
    slug: 'congo-dr', code: 'COD', name: 'Congo DR',
    aliases: ['DR Congo', 'Democratic Republic of Congo', 'D.R. Congo', 'RD Congo'],
    soccerwayKey: 'phn9mm8H',
    soccerwaySlug: 'd-r-congo',
  },
  {
    slug: 'uzbekistan', code: 'UZB', name: 'Uzbekistan',
    aliases: [],
    soccerwayKey: 'EZYKKRMc',
  },
  {
    slug: 'colombia', code: 'COL', name: 'Colombia',
    aliases: [],
    soccerwayKey: 'G02s4PCS',
  },

  // ── GROUP L ──────────────────────────────────────────────────────────────────
  {
    slug: 'england', code: 'ENG', name: 'England',
    aliases: [],
    soccerwayKey: 'j9N9ZNFA',
  },
  {
    slug: 'ghana', code: 'GHA', name: 'Ghana',
    aliases: ['Black Stars'],
    soccerwayKey: 'nNBjHale',
  },
  {
    slug: 'croatia', code: 'CRO', name: 'Croatia',
    aliases: ['Hrvatska'],
    soccerwayKey: 'K8aznggo',
  },
  {
    slug: 'panama', code: 'PAN', name: 'Panama',
    aliases: [],
    soccerwayKey: 'OWKqbCfi',
  },
];
