// ============================================================
// NYC TRANSIT DISPLAY — SERVER CONFIGURATION
// ============================================================
// Station selection is now done in the UI (Settings drawer).
// This file only controls server-level settings.
// ============================================================

module.exports = {
  port: process.env.PORT || 3001,
  apiKey: process.env.MTA_API_KEY || '',
  busApiKey: process.env.MTA_BUS_KEY || '',
  locationIqToken: process.env.LOCATIONIQ_TOKEN || '',

  cacheTTL: 10_000,          // ms – how long to cache each protobuf feed
  maxArrivalsPerRoute: 4,    // arrivals shown per direction per route

  // Route → GTFS-RT feed key mapping
  routeToFeed: {
    '1': 'num', '2': 'num', '3': 'num',
    '4': 'num', '5': 'num', '6': 'num', '7': 'num',
    'GS': 'num', 'S': 'num', 'FS': 'num', 'H': 'num',
    'A': 'ace', 'C': 'ace', 'E': 'ace',
    'B': 'bdfm', 'D': 'bdfm', 'F': 'bdfm', 'M': 'bdfm',
    'G': 'g',
    'J': 'jz', 'Z': 'jz',
    'N': 'nqrw', 'Q': 'nqrw', 'R': 'nqrw', 'W': 'nqrw',
    'L': 'l',
    'SI': 'si',
  },

  feedEndpoints: {
    num:  'https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fgtfs',
    ace:  'https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fgtfs-ace',
    bdfm: 'https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fgtfs-bdfm',
    g:    'https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fgtfs-g',
    jz:   'https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fgtfs-jz',
    nqrw: 'https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fgtfs-nqrw',
    l:    'https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fgtfs-l',
    si:   'https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fgtfs-si',
  },
};
