'use client';

import React, { useRef, useEffect, useState } from 'react';
import mapboxgl from 'mapbox-gl';
import EXIF from 'exif-js';

interface MapProps {
    trackGeoJSON: any;
}

interface PhotoWaypoint {
    id: string;
    url: string;
    lat: number;
    lng: number;
    shown: boolean;
    hasGPS?: boolean;
    timestamp?: number;
}

export default function Map({ trackGeoJSON }: MapProps) {
    const mapContainer = useRef<HTMLDivElement>(null);
    const map = useRef<mapboxgl.Map | null>(null);
    const [isPlaying, setIsPlaying] = useState(false);
    const isPlayingRef = useRef(false); // Track play state for animation loop
    const [error, setError] = useState<string | null>(null);
    const [spriteUrl, setSpriteUrl] = useState<string | null>(null);
    const animationFrameId = useRef<number | null>(null);
    const paceRef = useRef<HTMLParagraphElement>(null);
    const lastPaceUpdateTime = useRef<number>(0);

    // Photo State
    const [photos, setPhotos] = useState<PhotoWaypoint[]>([]);
    const [activePhoto, setActivePhoto] = useState<PhotoWaypoint | null>(null);
    const animationProgressTime = useRef<number>(0);
    const lastFrameTime = useRef<number>(0);
    const isPausedRef = useRef(false);
    const shownPhotoIds = useRef<Set<string>>(new Set());

    useEffect(() => {
        if (!process.env.NEXT_PUBLIC_MAPBOX_TOKEN) {
            setError('Missing Mapbox Token. Please add NEXT_PUBLIC_MAPBOX_TOKEN to .env.local and restart server.');
            return;
        }

        if (map.current) return;

        mapboxgl.accessToken = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;

        map.current = new mapboxgl.Map({
            container: mapContainer.current!,
            style: 'mapbox://styles/mapbox/satellite-streets-v12',
            center: [6.865, 45.832], // Default center (Mont Blanc area)
            zoom: 11,
            pitch: 60,
            bearing: 0,
        });

        map.current.on('load', () => {
            if (!map.current) return;

            // Add 3D Terrain
            map.current.addSource('mapbox-dem', {
                'type': 'raster-dem',
                'url': 'mapbox://mapbox.mapbox-terrain-dem-v1',
                'tileSize': 512,
                'maxzoom': 14
            });
            map.current.setTerrain({ 'source': 'mapbox-dem', 'exaggeration': 1.5 });

            // Sky layer for atmosphere
            map.current.addLayer({
                'id': 'sky',
                'type': 'sky',
                'paint': {
                    'sky-type': 'atmosphere',
                    'sky-atmosphere-sun': [0.0, 0.0],
                    'sky-atmosphere-sun-intensity': 15
                }
            });

            // Localize labels to Japanese if available
            const layers = map.current.getStyle().layers;
            if (layers) {
                for (const layer of layers) {
                    if (layer.type === 'symbol' && layer.layout && layer.layout['text-field']) {
                        // Use coalesce to try name_ja first, then name
                        map.current.setLayoutProperty(layer.id, 'text-field', [
                            'coalesce',
                            ['get', 'name_ja'],
                            ['get', 'name']
                        ]);
                    }
                }
            }
        });

        return () => {
            map.current?.remove();
            map.current = null;
        };
    }, []);

    // Green screen processing (Still used for fallback/reference, though Emoji is active)
    useEffect(() => {
        const img = new Image();
        img.crossOrigin = "Anonymous";
        img.src = '/runner-pose.png';
        img.onload = () => {
            // ... kept for completeness if we switch back
            setSpriteUrl('/runner-pose.png');
        };
    }, []);

    useEffect(() => {
        if (!map.current || !trackGeoJSON) return;
        const mapInstance = map.current;
        if (!mapInstance.isStyleLoaded()) {
            mapInstance.once('style.load', () => updateTrack(mapInstance, trackGeoJSON));
        } else {
            updateTrack(mapInstance, trackGeoJSON);
        }
    }, [trackGeoJSON]);

    const updateTrack = (mapInstance: mapboxgl.Map, geojson: any) => {
        const trackFeature = geojson.features.find((f: any) => f.geometry.type === 'LineString');
        if (!trackFeature) {
            console.warn("No LineString found in GeoJSON");
            return;
        }

        const sourceId = 'route';
        if (mapInstance.getSource(sourceId)) {
            (mapInstance.getSource(sourceId) as mapboxgl.GeoJSONSource).setData(geojson);
        } else {
            mapInstance.addSource(sourceId, { type: 'geojson', data: geojson });
            mapInstance.addLayer({
                id: 'route',
                type: 'line',
                source: sourceId,
                layout: { 'line-join': 'round', 'line-cap': 'round' },
                paint: { 'line-color': '#ff0000', 'line-width': 4 },
            });
        }

        const coordinates = trackFeature.geometry.coordinates;
        const bounds = new mapboxgl.LngLatBounds(coordinates[0], coordinates[0]);
        for (const coord of coordinates) {
            bounds.extend(coord as [number, number]);
        }
        mapInstance.fitBounds(bounds, { padding: 50, animate: true });

        // Also render photo markers if any
        renderPhotoMarkers();
    };

    const renderPhotoMarkers = () => {
        if (!map.current) return;
        // Remove old photo markers
        const existing = document.getElementsByClassName('photo-marker');
        while (existing.length > 0) existing[0].parentNode?.removeChild(existing[0]);


        const validPhotos = photos.filter(p => p.hasGPS);

        validPhotos.forEach(photo => {
            const el = document.createElement('div');
            el.className = 'photo-marker';
            el.innerHTML = '📷';
            el.style.fontSize = '24px';
            el.style.cursor = 'pointer';

            new mapboxgl.Marker(el)
                .setLngLat([photo.lng, photo.lat])
                .addTo(map.current!);
        });
    }

    // Re-render markers when photos change
    useEffect(() => {
        renderPhotoMarkers();
    }, [photos]);


    const handlePhotoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = e.target.files;
        if (!files) return;

        Array.from(files).forEach(file => {
            // Check for HEIC/HEIF files which browsers often don't support natively
            if (file.type === 'image/heic' || file.type === 'image/heif' || file.name.toLowerCase().endsWith('.heic')) {
                alert(`HEIF/HEIC format (${file.name}) is not supported. Please convert to JPEG or PNG.`);
                return;
            }

            const tempId = Math.random().toString();

            const reader = new FileReader();
            reader.onload = (readerEvent) => {
                const url = readerEvent.target?.result as string;
                if (!url) return;

                // 1. Add photo immediately (visual feedback)
                setPhotos(prev => [...prev, {
                    id: tempId,
                    url,
                    lat: 0,
                    lng: 0,
                    shown: false,
                    hasGPS: false,
                    timestamp: undefined
                }]);

                // 2. Try to extract EXIF data (for JPG markers)
                // @ts-ignore
                EXIF.getData(file, function () {
                    // @ts-ignore
                    const lat = EXIF.getTag(this, "GPSLatitude");
                    // @ts-ignore
                    const lng = EXIF.getTag(this, "GPSLongitude");
                    // @ts-ignore
                    const latRef = EXIF.getTag(this, "GPSLatitudeRef");
                    // @ts-ignore
                    const lngRef = EXIF.getTag(this, "GPSLongitudeRef");
                    // @ts-ignore
                    const dateTimeOriginal = EXIF.getTag(this, "DateTimeOriginal");

                    let timestamp: number | undefined;

                    if (dateTimeOriginal) {
                        // EXIF format is "YYYY:MM:DD HH:MM:SS"
                        const [datePart, timePart] = dateTimeOriginal.split(' ');
                        const [year, month, day] = datePart.split(':');
                        const [hour, min, sec] = timePart.split(':');
                        const dateObj = new Date(parseInt(year), parseInt(month) - 1, parseInt(day), parseInt(hour), parseInt(min), parseInt(sec));
                        timestamp = dateObj.getTime();
                    }

                    if (lat && lng && latRef && lngRef) {
                        const convertDMSToDD = (dms: number[], ref: string) => {
                            let dd = dms[0] + dms[1] / 60 + dms[2] / 3600;
                            if (ref === "S" || ref === "W") {
                                dd = dd * -1;
                            }
                            return dd;
                        };

                        const latitude = convertDMSToDD(lat, latRef);
                        const longitude = convertDMSToDD(lng, lngRef);

                        // Update the existing photo with GPS data
                        setPhotos(prev => prev.map(p => {
                            if (p.id === tempId) {
                                return {
                                    ...p,
                                    lat: latitude,
                                    lng: longitude,
                                    hasGPS: true,
                                    timestamp
                                };
                            }
                            return p;
                        }));
                    } else {
                        console.warn(`No GPS data found in ${file.name}`);
                    }
                });
            };
            reader.readAsDataURL(file);
        });

        // Reset input value
        e.target.value = '';
    };

    const startAnimation = () => {
        if (!map.current || !trackGeoJSON) return;

        // Cleanup previous run
        if (isPlayingRef.current) {
            isPlayingRef.current = false;
            if (animationFrameId.current) cancelAnimationFrame(animationFrameId.current);
        }

        setIsPlaying(true);
        isPlayingRef.current = true;
        isPausedRef.current = false;
        lastPaceUpdateTime.current = 0;
        animationProgressTime.current = 0;
        lastFrameTime.current = performance.now();
        shownPhotoIds.current.clear();

        // Reset photos shown state locally (visual only, effective state in ref)
        setPhotos(prev => prev.map(p => ({ ...p, shown: false })));

        const trackFeature = trackGeoJSON.features.find((f: any) => f.geometry.type === 'LineString');
        if (!trackFeature) return;

        const coordinates = trackFeature.geometry.coordinates;
        const totalPoints = coordinates.length;

        if (!coordinates || coordinates.length < 2) return;

        // Remove existing markers if any (simple cleanup attempt)
        const existing = document.getElementsByClassName('runner-marker');
        while (existing.length > 0) {
            existing[0].parentNode?.removeChild(existing[0]);
        }

        // Create HTML marker for the runner
        const el = document.createElement('div');
        el.className = 'runner-marker-container';
        el.innerHTML = '🏃';
        el.style.fontSize = '48px';
        el.style.textAlign = 'center';
        el.style.display = 'flex';
        el.style.alignItems = 'center';
        el.style.justifyContent = 'center';
        el.style.lineHeight = '1';

        const marker = new mapboxgl.Marker(el)
            .setLngLat(coordinates[0] as [number, number])
            .addTo(map.current);

        // Duration in milliseconds (60 seconds)
        const duration = 60000;

        const animate = (time: number) => {
            if (!map.current || !isPlayingRef.current) return;

            const deltaTime = time - lastFrameTime.current;
            lastFrameTime.current = time;

            if (isPausedRef.current) {
                // If paused, just loop without progressing
                animationFrameId.current = requestAnimationFrame(animate);
                return;
            }

            animationProgressTime.current += deltaTime;
            const elapsed = animationProgressTime.current;
            const progress = Math.min(elapsed / duration, 1); // Clamp to 1

            // Calculate current index float
            const floatIndex = progress * (totalPoints - 1);
            const index = Math.floor(floatIndex);
            const nextIndex = Math.min(index + 1, totalPoints - 1);
            const ratio = floatIndex - index;

            const currentP = coordinates[index];
            const nextP = coordinates[nextIndex];

            // Guard against undefined 
            if (!currentP || !nextP) {
                animationFrameId.current = requestAnimationFrame(animate);
                return;
            }

            // Linear Interpolation (Strict Path Following)
            const lng = currentP[0] + (nextP[0] - currentP[0]) * ratio;
            const lat = currentP[1] + (nextP[1] - currentP[1]) * ratio;
            const interpolatedCoord = [lng, lat] as [number, number];

            // Update marker position
            marker.setLngLat(interpolatedCoord);

            // Check for photo waypoints
            // Simple distance check: if within ~50m of a photo we haven't shown
            // 0.0005 degrees is roughly 50m
            for (const photo of photos) {
                if (shownPhotoIds.current.has(photo.id)) continue;

                const dLat = Math.abs(photo.lat - lat);
                const dLng = Math.abs(photo.lng - lng);

                if (dLat < 0.0005 && dLng < 0.0005) {
                    // Trigger Pause
                    isPausedRef.current = true;
                    shownPhotoIds.current.add(photo.id);
                    setActivePhoto(photo);

                    // Resume after 1 second
                    setTimeout(() => {
                        setActivePhoto(null);
                        isPausedRef.current = false;
                        // Reset lastFrameTime to now to avoid huge delta jump
                        lastFrameTime.current = performance.now();
                    }, 1000);
                    break; // Handle one at a time
                }
            }

            if (progress >= 1) {
                marker.setLngLat(coordinates[totalPoints - 1] as [number, number]);
                setIsPlaying(false);
                isPlayingRef.current = false;
                return;
            }

            // Cinematic Orbit Camera
            // Rotate slowly around the runner to avoid static occlusion
            const rotationSpeed = 0.02; // Degrees per millisecond (approx 20 deg/sec)
            const bearing = (elapsed * rotationSpeed) % 360;

            // Calculate Pace - Throttled to every 2 seconds (2000ms)
            if (time - lastPaceUpdateTime.current > 2000) {
                lastPaceUpdateTime.current = time;

                if (paceRef.current && trackFeature.properties?.coordTimes) {
                    const times = trackFeature.properties.coordTimes;
                    // Check if index changed significantly or just use current
                    // Use instantaneous pace of current segment
                    const t1 = new Date(times[index]).getTime();
                    const t2 = new Date(times[nextIndex]).getTime();
                    const timeDiffHours = (t2 - t1) / 1000 / 3600; // hours

                    if (timeDiffHours > 0) {
                        const distKm = getDistanceFromLatLonInKm(
                            currentP[1], currentP[0],
                            nextP[1], nextP[0]
                        );

                        if (distKm > 0) {
                            const speedKmH = distKm / timeDiffHours;
                            const paceMinKm = 60 / speedKmH;

                            // Format to MM:SS
                            const min = Math.floor(paceMinKm);
                            const sec = Math.floor((paceMinKm - min) * 60);
                            if (min < 30) { // Valid run pace check
                                paceRef.current.innerText = `${min}:${sec.toString().padStart(2, '0')} /km`;
                            }
                        }
                    }
                }
            }

            // Fly along
            map.current.jumpTo({
                center: interpolatedCoord,
                bearing: bearing,
                pitch: 50, // Slightly more top-down to see over mountains
                zoom: 14 // Zoom out slightly to clear terrain
            });

            animationFrameId.current = requestAnimationFrame(animate);
        }

        animationFrameId.current = requestAnimationFrame(animate);
    };

    // Haversine distance
    function getDistanceFromLatLonInKm(lat1: number, lon1: number, lat2: number, lon2: number) {
        var R = 6371; // Radius of the earth in km
        var dLat = deg2rad(lat2 - lat1);  // deg2rad below
        var dLon = deg2rad(lon2 - lon1);
        var a =
            Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(deg2rad(lat1)) * Math.cos(deg2rad(lat2)) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2)
            ;
        var c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        var d = R * c; // Distance in km
        return d;
    }

    function deg2rad(deg: number) {
        return deg * (Math.PI / 180)
    }

    // Helper calculate bearing
    function calculateBearing(start: number[], end: number[]) {
        if (!start || !end || start.length < 2 || end.length < 2) return 0;
        const startLat = start[1] * Math.PI / 180;
        const startLng = start[0] * Math.PI / 180;
        const endLat = end[1] * Math.PI / 180;
        const endLng = end[0] * Math.PI / 180;

        const y = Math.sin(endLng - startLng) * Math.cos(endLat);
        const x = Math.cos(startLat) * Math.sin(endLat) -
            Math.sin(startLat) * Math.cos(endLat) * Math.cos(endLng - startLng);
        const bearing = Math.atan2(y, x);
        return (bearing * 180 / Math.PI + 360) % 360;
    }

    // Video Recording State - REMOVED

    if (error) {
        return (
            <div className="w-full h-[600px] rounded-xl flex items-center justify-center bg-gray-900 border-2 border-red-500 text-red-500 p-8 text-center">
                <div>
                    <h3 className="text-2xl font-bold mb-4">Configuration Error</h3>
                    <p className="text-lg">{error}</p>
                </div>
            </div>
        );
    }

    return (
        <div className="flex flex-col gap-6 w-full">
            <div className="relative w-full h-[600px] rounded-xl overflow-hidden shadow-2xl">
                <div ref={mapContainer} className="w-full h-full" />

                {/* Active Photo Overlay */}
                {activePhoto && (
                    <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in zoom-in duration-300">
                        <div className="relative max-w-[80%] max-h-[80%] p-2 bg-white rounded-xl shadow-2xl transform scale-110 transition-transform">
                            <img
                                src={activePhoto.url}
                                alt="Waypoint"
                                className="max-w-full max-h-[600px] object-contain rounded-lg"
                            />
                            <div className="absolute -bottom-10 left-0 right-0 text-center text-white font-bold text-xl drop-shadow-md">
                                📍 Waypoint Reached
                            </div>
                        </div>
                    </div>
                )}

                {trackGeoJSON && (
                    <>
                        <div className="absolute bottom-6 right-6 z-10 flex flex-col gap-3 items-end">
                            <button
                                className="bg-red-600 text-white font-bold py-3 px-6 rounded-full shadow-lg hover:scale-105 transition-transform flex items-center gap-2"
                                onClick={() => startAnimation()}
                            >
                                {isPlaying ? (
                                    <>
                                        <span className="w-2 h-2 bg-white rounded-full animate-pulse" />
                                        Flying
                                    </>
                                ) : 'Start 3D Flyover'}
                            </button>
                        </div>

                        {isPlaying && (
                            <div className="absolute top-6 right-6 z-10 bg-black/70 backdrop-blur-md text-white p-4 rounded-xl shadow-lg border border-white/10">
                                <div className="flex items-center gap-3 mb-2">
                                    <span className="text-2xl">🏃</span>
                                    <div>
                                        <p className="text-sm text-gray-400">Pace</p>
                                        <p ref={paceRef} className="font-bold font-mono">5:00 /km</p>
                                    </div>
                                </div>
                            </div>
                        )}
                    </>
                )}
            </div>

            {/* Photo Gallery & Upload Section */}
            <div className="w-full bg-white/5 rounded-xl p-6 border border-white/10">
                <div className="flex items-center justify-between mb-4">
                    <h3 className="text-xl font-bold flex items-center gap-2">
                        <span>📸</span> Photos
                    </h3>
                    <label className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded-lg shadow-md transition-colors flex items-center gap-2 cursor-pointer">
                        <span>+ Add Photos</span>
                        <input
                            type="file"
                            multiple
                            accept="image/jpeg,image/png,image/webp,image/gif"
                            className="hidden"
                            onChange={handlePhotoUpload}
                        />
                    </label>
                </div>

                {photos.length === 0 ? (
                    <div className="text-center py-8 text-gray-500 border-2 border-dashed border-gray-700 rounded-lg">
                        <p>No photos uploaded yet. Add photos to create waypoints!</p>
                    </div>
                ) : (
                    <div className="flex gap-4 overflow-x-auto pb-2 scrollbar-hide">
                        {photos.map((photo) => (
                            <div
                                key={photo.id}
                                className="relative flex-shrink-0 w-32 h-32 rounded-lg overflow-hidden border-2 border-transparent hover:border-red-500 transition-colors cursor-pointer group"
                                onClick={() => {
                                    setActivePhoto({ ...photo, shown: true });
                                    setTimeout(() => setActivePhoto(null), 3000);
                                }}
                            >
                                <img
                                    src={photo.url}
                                    alt="Gallery item"
                                    className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-500"
                                />
                                {photo.shown && (
                                    <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
                                        <span className="text-green-400 text-xl">✓</span>
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}
