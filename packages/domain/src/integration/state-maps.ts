import type { Jurisdiction } from '../config/codes.js';

/**
 * Free state and territory government map services: an online viewer the valuer can open for the
 * property (planning, title and aerial layers), and, where published, a basemap tile service the
 * app can draw under the job's properties and sales. Endpoints, attribution and terms of use are
 * confirmed by the data-licensing reviewer before use. [REVIEW: DATA_LICENSING]
 */
export interface StateMapService {
  readonly jurisdiction: Jurisdiction;
  readonly viewer: { readonly name: string; readonly url: string };
  /** Planning viewer where it differs from the main viewer. */
  readonly planningViewer?: { readonly name: string; readonly url: string };
  /** XYZ tile template ({z}/{y}/{x} for ArcGIS REST caches, {z}/{x}/{y} for WMTS-style paths). */
  readonly basemap?: {
    readonly name: string;
    readonly urlTemplate: string;
    readonly attribution: string;
    readonly licence: string;
  };
  readonly custodian: string;
}

export const STATE_MAP_SERVICES: Readonly<Record<Jurisdiction, StateMapService>> = {
  VIC: {
    jurisdiction: 'VIC',
    viewer: { name: 'VicPlan', url: 'https://mapshare.vic.gov.au/vicplan/' },
    basemap: {
      name: 'Vicmap Basemaps (cartographic)',
      urlTemplate: 'https://base.maps.vic.gov.au/wmts/CARTO_WM_256/EPSG:3857/{z}/{x}/{y}.png',
      attribution: '© State of Victoria (Department of Transport and Planning)',
      licence: 'CC BY 4.0 (to be confirmed)',
    },
    custodian: 'Department of Transport and Planning (VIC)',
  },
  NSW: {
    jurisdiction: 'NSW',
    viewer: { name: 'SIX Maps', url: 'https://maps.six.nsw.gov.au/' },
    planningViewer: {
      name: 'NSW Planning Portal spatial viewer',
      url: 'https://www.planningportal.nsw.gov.au/spatialviewer/',
    },
    basemap: {
      name: 'NSW Base Map',
      urlTemplate:
        'https://maps.six.nsw.gov.au/arcgis/rest/services/public/NSW_Base_Map/MapServer/tile/{z}/{y}/{x}',
      attribution: '© Spatial Services, Department of Customer Service NSW',
      licence: 'CC BY 4.0 (to be confirmed)',
    },
    custodian: 'Spatial Services NSW',
  },
  QLD: {
    jurisdiction: 'QLD',
    viewer: { name: 'Queensland Globe', url: 'https://qldglobe.information.qld.gov.au/' },
    basemap: {
      name: 'Queensland basemap (topographic)',
      urlTemplate:
        'https://spatial-gis.information.qld.gov.au/arcgis/rest/services/Basemaps/QldMap_Topo/MapServer/tile/{z}/{y}/{x}',
      attribution: '© State of Queensland (Department of Resources)',
      licence: 'CC BY 4.0 (to be confirmed)',
    },
    custodian: 'Department of Resources (QLD)',
  },
  WA: {
    jurisdiction: 'WA',
    viewer: {
      name: 'Landgate Map Viewer Plus',
      url: 'https://map-viewer-plus.app.landgate.wa.gov.au/',
    },
    custodian: 'Landgate (WA)',
  },
  SA: {
    jurisdiction: 'SA',
    viewer: { name: 'Location SA Map Viewer', url: 'https://location.sa.gov.au/viewer/' },
    planningViewer: {
      name: 'SA Property and Planning Atlas',
      url: 'https://sappa.plan.sa.gov.au/',
    },
    custodian: 'Department for Infrastructure and Transport (SA)',
  },
  TAS: {
    jurisdiction: 'TAS',
    viewer: { name: 'LISTmap', url: 'https://maps.thelist.tas.gov.au/listmap/app/list/map' },
    custodian: 'Land Tasmania (theLIST)',
  },
  ACT: {
    jurisdiction: 'ACT',
    viewer: { name: 'ACTmapi', url: 'https://www.actmapi.act.gov.au/' },
    custodian: 'ACT Government (ACTmapi)',
  },
  NT: {
    jurisdiction: 'NT',
    viewer: { name: 'NR Maps', url: 'https://nrmaps.nt.gov.au/' },
    custodian: 'Northern Territory Government',
  },
};

/** Great-circle distance in kilometres (for "within 2 km" searches and map labels). */
export function distanceKm(
  a: { readonly lat: number; readonly lng: number },
  b: { readonly lat: number; readonly lng: number },
): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(h)));
}
