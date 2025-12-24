import { gpx } from '@mapbox/togeojson';

export const parseGPX = (gpxContent: string) => {
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(gpxContent, 'text/xml');
    return gpx(xmlDoc);
};
