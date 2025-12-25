'use client';

import React, { useRef, useEffect, useState } from 'react';
import mapboxgl from 'mapbox-gl';
import EXIF from 'exif-js';
import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile, toBlobURL } from '@ffmpeg/util';

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

    const [isMapLoaded, setIsMapLoaded] = useState(false);

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
            preserveDrawingBuffer: true // Required for canvas.captureStream
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

            // Sky layer
            map.current.addLayer({
                'id': 'sky',
                'type': 'sky',
                'paint': {
                    'sky-type': 'atmosphere',
                    'sky-atmosphere-sun': [0.0, 0.0],
                    'sky-atmosphere-sun-intensity': 15
                }
            });

            // Localize labels
            const layers = map.current.getStyle().layers;
            if (layers) {
                for (const layer of layers) {
                    if (layer.type === 'symbol' && layer.layout && layer.layout['text-field']) {
                        map.current.setLayoutProperty(layer.id, 'text-field', [
                            'coalesce',
                            ['get', 'name_ja'],
                            ['get', 'name']
                        ]);
                    }
                }
            }

            // Create Canvas-based Icons for Emojis (Avoids font issues)
            const createEmojiIcon = (emoji: string): HTMLImageElement | undefined => {
                const canvas = document.createElement('canvas');
                canvas.width = 64;
                canvas.height = 64;
                const ctx = canvas.getContext('2d');
                if (!ctx) return;
                ctx.font = '54px serif'; // Use serif/sans-serif to grab system emoji
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText(emoji, 32, 34); // Centered w/ slight offset

                const img = new Image(64, 64);
                img.src = canvas.toDataURL();
                return img;
            };

            const runnerImg = createEmojiIcon('🏃');
            if (runnerImg) {
                runnerImg.onload = () => {
                    if (!map.current) return;
                    map.current.addImage('runner-icon', runnerImg);
                    // Only add layers after image is loaded to avoid missing icon errors

                    // Initialize Sources for Runner if not exists
                    if (!map.current.getSource('runner-point')) {
                        map.current.addSource('runner-point', {
                            type: 'geojson',
                            data: { type: 'FeatureCollection', features: [] }
                        });
                    }

                    if (!map.current.getLayer('runner-glow')) {
                        map.current.addLayer({
                            id: 'runner-glow',
                            source: 'runner-point',
                            type: 'circle',
                            paint: {
                                'circle-radius': 20,
                                'circle-color': '#ffffff',
                                'circle-opacity': 0.6,
                                'circle-blur': 0.5
                            }
                        });
                    }

                    if (!map.current.getLayer('runner')) {
                        map.current.addLayer({
                            id: 'runner',
                            source: 'runner-point',
                            type: 'symbol',
                            layout: {
                                'icon-image': 'runner-icon',
                                'icon-size': 1.0,
                                'icon-allow-overlap': true,
                                'icon-ignore-placement': true
                            }
                        });
                    }
                };
            }

            const photoImg = createEmojiIcon('📷');
            if (photoImg) {
                photoImg.onload = () => {
                    if (!map.current) return;
                    map.current.addImage('photo-icon', photoImg);

                    // Initialize Sources for Photos
                    if (!map.current.getSource('photo-points')) {
                        map.current.addSource('photo-points', {
                            type: 'geojson',
                            data: { type: 'FeatureCollection', features: [] }
                        });
                    }

                    if (!map.current.getLayer('photos')) {
                        map.current.addLayer({
                            id: 'photos',
                            source: 'photo-points',
                            type: 'symbol',
                            layout: {
                                'icon-image': 'photo-icon',
                                'icon-size': 0.8,
                                'icon-allow-overlap': true
                            },
                            paint: {
                                // removing text halo as we are using icon now
                            }
                        });
                    }
                };
            }

            setIsMapLoaded(true);
        });

        return () => {
            map.current?.remove();
            map.current = null;
        };
    }, []);

    // ... (keep useEffect for green screen if needed, or remove)

    // Update track rendering
    useEffect(() => {
        if (!map.current || !trackGeoJSON || !isMapLoaded) return;
        updateTrack(map.current, trackGeoJSON);
    }, [trackGeoJSON, isMapLoaded]);

    const updateTrack = (mapInstance: mapboxgl.Map, geojson: any) => {
        console.log("Map: updating track with GeoJSON:", geojson);
        if (!geojson || !geojson.features) {
            console.error("Map: Invalid GeoJSON data");
            return;
        }

        const trackFeature = geojson.features.find((f: any) => f.geometry.type === 'LineString');
        if (!trackFeature) {
            console.error("Map: No LineString feature found in GeoJSON");
            return;
        }

        console.log("Map: Found track feature, coordinates:", trackFeature.geometry.coordinates?.length);
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

        // Initialize Runner at Start Position
        const coordinates = trackFeature.geometry.coordinates;
        if (coordinates && coordinates.length > 0) {
            const startCoord = coordinates[0];
            const runnerSource = mapInstance.getSource('runner-point') as mapboxgl.GeoJSONSource;
            if (runnerSource) {
                runnerSource.setData({
                    type: 'Feature',
                    geometry: {
                        type: 'Point',
                        coordinates: startCoord
                    },
                    properties: {}
                });
            }
        }

        // Ensure proper layer ordering: Route < Runner Glow < Runner < Photos
        if (mapInstance.getLayer('route')) {
            if (mapInstance.getLayer('runner-glow')) mapInstance.moveLayer('runner-glow');
            if (mapInstance.getLayer('runner')) mapInstance.moveLayer('runner');
            if (mapInstance.getLayer('photos')) mapInstance.moveLayer('photos');
        }

        const bounds = new mapboxgl.LngLatBounds(coordinates[0], coordinates[0]);
        for (const coord of coordinates) {
            bounds.extend(coord as [number, number]);
        }
        mapInstance.fitBounds(bounds, { padding: 50, animate: true });

        // Sync photo markers to map source
        updatePhotoMarkersSource();
    };

    const updatePhotoMarkersSource = () => {
        if (!map.current || !map.current.getSource('photo-points')) return;

        const validPhotos = photos.filter(p => p.hasGPS);
        const features = validPhotos.map(p => ({
            type: 'Feature',
            geometry: {
                type: 'Point',
                coordinates: [p.lng, p.lat]
            },
            properties: {
                id: p.id
            }
        }));

        (map.current.getSource('photo-points') as mapboxgl.GeoJSONSource).setData({
            type: 'FeatureCollection',
            features: features as any
        });
    };

    // Replace renderPhotoMarkers with source update
    useEffect(() => {
        updatePhotoMarkersSource();
    }, [photos]);

    const handlePhotoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = e.target.files;
        if (!files) return;

        Array.from(files).forEach(file => {
            if (file.type === 'image/heic' || file.type === 'image/heif' || file.name.toLowerCase().endsWith('.heic')) {
                alert(`HEIF/HEIC format (${file.name}) is not supported. Please convert to JPEG or PNG.`);
                return;
            }

            const tempId = Math.random().toString();
            const reader = new FileReader();
            reader.onload = (readerEvent) => {
                const url = readerEvent.target?.result as string;
                if (!url) return;

                setPhotos(prev => [...prev, {
                    id: tempId,
                    url,
                    lat: 0,
                    lng: 0,
                    shown: false,
                    hasGPS: false,
                    timestamp: undefined
                }]);

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
        e.target.value = '';
    };


    const startRecording = async () => {
        if (!map.current) return;
        try {
            setIsRecording(true);

            // Capture Canvas Stream (Silent, no prompt!)
            const canvas = map.current.getCanvas();
            const stream = canvas.captureStream(30); // 30 FPS

            // 3. Start Recording
            const recorder = new MediaRecorder(stream, { mimeType: 'video/webm; codecs=vp9' });
            mediaRecorderRef.current = recorder;
            recordedChunksRef.current = [];

            recorder.ondataavailable = (event) => {
                if (event.data.size > 0) {
                    recordedChunksRef.current.push(event.data);
                }
            };

            // ... (rest of recorder.onstop logic is same)
            recorder.onstop = async () => {
                stream.getTracks().forEach(track => track.stop());
                setIsRecording(false);
                const webmBlob = new Blob(recordedChunksRef.current, { type: 'video/webm' });
                await transcodeVideo(webmBlob);
            };

            recorder.start();

        } catch (err) {
            console.error("Error starting recording:", err);
            setIsRecording(false);
        }
    };

    // ... (stopRecording, transcodeVideo remain similar)

    const startAnimation = () => {
        if (!map.current || !trackGeoJSON) return;

        // ... (cleanup) ...
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
        setPhotos(prev => prev.map(p => ({ ...p, shown: false }))); // Reset visual

        const trackFeature = trackGeoJSON.features.find((f: any) => f.geometry.type === 'LineString');
        if (!trackFeature) return;

        const coordinates = trackFeature.geometry.coordinates;
        const totalPoints = coordinates.length;
        // Don't create DOM Marker anymore

        const duration = 60000;

        const animate = (time: number) => {
            if (!map.current || !isPlayingRef.current) return;
            // ...Time delta logic...
            const deltaTime = time - lastFrameTime.current;
            lastFrameTime.current = time;

            if (isPausedRef.current) {
                animationFrameId.current = requestAnimationFrame(animate);
                return;
            }

            animationProgressTime.current += deltaTime;
            const elapsed = animationProgressTime.current;
            const progress = Math.min(elapsed / duration, 1);

            // ... Index/Ratio logic ...
            const floatIndex = progress * (totalPoints - 1);
            const index = Math.floor(floatIndex);
            const nextIndex = Math.min(index + 1, totalPoints - 1);
            const ratio = floatIndex - index;

            const currentP = coordinates[index];
            const nextP = coordinates[nextIndex];

            if (!currentP || !nextP) {
                animationFrameId.current = requestAnimationFrame(animate);
                return;
            }

            // Interpolation
            const lng = currentP[0] + (nextP[0] - currentP[0]) * ratio;
            const lat = currentP[1] + (nextP[1] - currentP[1]) * ratio;
            const interpolatedCoord = [lng, lat] as [number, number];

            // UPDATE RUNNER SOURCE
            if (map.current.getSource('runner-point')) {
                (map.current.getSource('runner-point') as mapboxgl.GeoJSONSource).setData({
                    type: 'Feature',
                    geometry: {
                        type: 'Point',
                        coordinates: [lng, lat]
                    },
                    properties: {}
                });
            }

            // ... Photo check logic (same as before) ...
            for (const photo of photos) {
                // ... logic ...
                if (shownPhotoIds.current.has(photo.id)) continue;
                const dLat = Math.abs(photo.lat - lat);
                const dLng = Math.abs(photo.lng - lng);
                if (dLat < 0.0005 && dLng < 0.0005) {
                    // Pause logic
                    isPausedRef.current = true;
                    shownPhotoIds.current.add(photo.id);
                    setActivePhoto(photo);
                    setTimeout(() => {
                        setActivePhoto(null);
                        isPausedRef.current = false;
                        lastFrameTime.current = performance.now();
                    }, 1000);
                    break;
                }
            }

            if (progress >= 1) {
                setIsPlaying(false);
                isPlayingRef.current = false;
                // Stop recording if active
                if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
                    stopRecording();
                }
                return;
            }

            // ... Camera logic ...
            const rotationSpeed = 0.02;
            const bearing = (elapsed * rotationSpeed) % 360;

            // Calculate Pace
            if (time - lastPaceUpdateTime.current > 1000) {
                const dist = getDistanceFromLatLonInKm(
                    coordinates[index][1], coordinates[index][0],
                    coordinates[nextIndex][1], coordinates[nextIndex][0]
                );
                const timeDiffHours = (trackFeature.properties?.coordTimes ?
                    (new Date(trackFeature.properties.coordTimes[nextIndex]).getTime() - new Date(trackFeature.properties.coordTimes[index]).getTime()) / 3600000 :
                    0.000277); // Default 1 sec if no time data

                if (dist > 0 && timeDiffHours > 0) {
                    const speed = dist / timeDiffHours; // km/h
                    const pace = 60 / speed; // min/km
                    const min = Math.floor(pace);
                    const sec = Math.round((pace - min) * 60);
                    if (paceRef.current) {
                        paceRef.current.innerText = `${min}:${sec.toString().padStart(2, '0')} /km`;
                    }
                }
                lastPaceUpdateTime.current = time;
            }

            map.current.jumpTo({
                center: interpolatedCoord,
                bearing: bearing,
                pitch: 50,
                zoom: 14
            });

            animationFrameId.current = requestAnimationFrame(animate);
        };
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

    // FFmpeg State
    const [ffmpegLoaded, setFfmpegLoaded] = useState(false);
    const ffmpegRef = useRef(new FFmpeg());
    const [isRecording, setIsRecording] = useState(false);
    const [isTranscoding, setIsTranscoding] = useState(false);
    const mediaRecorderRef = useRef<MediaRecorder | null>(null);
    const recordedChunksRef = useRef<Blob[]>([]);

    useEffect(() => {
        loadFfmpeg();
    }, []);

    const loadFfmpeg = async () => {
        const baseURL = 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd';
        const ffmpeg = ffmpegRef.current;
        ffmpeg.on('log', ({ message }) => {
            console.log(message);
        });

        try {
            await ffmpeg.load({
                coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript'),
                wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm'),
            });
            setFfmpegLoaded(true);
        } catch (error) {
            console.error("FFmpeg load failed:", error);
        }
    };



    const stopRecording = () => {
        if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
            mediaRecorderRef.current.stop();
        }
    };

    const transcodeVideo = async (webmBlob: Blob) => {
        if (!ffmpegLoaded) return;
        setIsTranscoding(true);
        const ffmpeg = ffmpegRef.current;

        try {
            await ffmpeg.writeFile('input.webm', await fetchFile(webmBlob));

            // Transcode to MP4 (H.264), optimized for size
            // -preset ultrafast: faster encoding
            // -crf 28: higher compression (lower quality, smaller size) target < 20MB
            // -movflags +faststart: web optimized
            await ffmpeg.exec([
                '-i', 'input.webm',
                '-c:v', 'libx264',
                '-preset', 'ultrafast',
                '-crf', '28',
                'output.mp4'
            ]);

            const data = await ffmpeg.readFile('output.mp4');
            const mp4Blob = new Blob([(data as Uint8Array).buffer as ArrayBuffer], { type: 'video/mp4' });

            const url = URL.createObjectURL(mp4Blob);
            const a = document.createElement('a');
            a.style.display = 'none';
            a.href = url;
            a.download = `relive-export-${new Date().toISOString().slice(0, 19)}.mp4`;
            document.body.appendChild(a);
            a.click();

            setTimeout(() => {
                document.body.removeChild(a);
                window.URL.revokeObjectURL(url);
            }, 100);

            // Cleanup
            await ffmpeg.deleteFile('input.webm');
            await ffmpeg.deleteFile('output.mp4');

        } catch (error) {
            console.error("Transcode failed:", error);
            alert("Video export failed during transcoding.");
        } finally {
            setIsTranscoding(false);
        }
    };

    if (error) {
        // ... (keep existing error UI)
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
            {/* Loading Overlay for Transcoding */}
            {isTranscoding && (
                <div className="fixed inset-0 z-[100] flex flex-col items-center justify-center bg-black/80 text-white backdrop-blur-md">
                    <div className="animate-spin text-6xl mb-4">⚙️</div>
                    <h2 className="text-2xl font-bold">Processing Video...</h2>
                    <p className="text-gray-400">Converting to Web-Ready MP4</p>
                </div>
            )}

            <div className="relative w-full h-[600px] rounded-xl overflow-hidden shadow-2xl group">
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

                {/* Controls - Hidden during recording */}
                {!isRecording && trackGeoJSON && (
                    <>
                        <div className="absolute bottom-6 right-6 z-10 flex flex-col gap-3 items-end transition-opacity duration-500">
                            <div className="flex gap-2">
                                {/* Recording Button */}
                                {ffmpegLoaded && (
                                    <button
                                        className="bg-purple-600 text-white font-bold py-3 px-6 rounded-full shadow-lg hover:scale-105 transition-transform flex items-center gap-2"
                                        onClick={startRecording}
                                    >
                                        <span>⏺ Export Video</span>
                                    </button>
                                )}

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

                {/* Recording Indicator */}
                {isRecording && (
                    <div className="absolute bottom-6 left-6 z-50 flex items-center gap-2 bg-red-600/90 text-white px-4 py-2 rounded-full animate-pulse">
                        <div className="w-3 h-3 bg-white rounded-full" />
                        <span className="font-bold">Recording... Click "Stop" in Chrome bar to finish</span>
                    </div>
                )}
            </div>

            {/* Photo Gallery - Hidden during recording if desired, or kept out of map frame. 
                User asked to hide UI *interface*, assuming Map UI. 
                Logic above hides controls ON the map. 
                The Gallery is OUTSIDE the map container, so getDisplayMedia of TAB would see it.
                We should hide the Gallery too if the user wants purely the map.
                Let's wrap the Gallery in !isRecording check too.
            */}
            {!isRecording && (
                <div className="w-full bg-white/5 rounded-xl p-6 border border-white/10 transition-opacity duration-500">
                    <div className="flex items-center justify-between mb-4">
                        <h3 className="text-xl font-bold flex items-center gap-2">
                            <span>📸</span> Photos
                        </h3>
                        {/* ... upload button ... */}
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
                    {/* ... existing gallery ... */}
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
            )}
        </div>
    );
}
