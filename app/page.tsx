'use client';

import { useState } from 'react';
import Uploader from '@/components/Uploader';
import Map from '@/components/Map';
import { parseGPX } from '@/utils/gpxParser';

export default function Home() {
  const [trackGeoJSON, setTrackGeoJSON] = useState<any>(null);
  const [step, setStep] = useState<'upload' | 'map'>('upload');

  const handleUpload = (fileContent: string) => {
    try {
      const parsed = parseGPX(fileContent);
      setTrackGeoJSON(parsed); // Correctly set the state used by Map
      setStep('map');
    } catch (e) {
      console.error(e);
      alert('Error parsing GPX file');
    }
  };

  const loadDemoRoute = async (path: string) => {
    try {
      console.log(`Fetching GPX from: ${path}`);
      const res = await fetch(path);
      if (!res.ok) {
        throw new Error(`Failed to fetch GPX: ${res.status} ${res.statusText}`);
      }
      const text = await res.text();
      console.log(`GPX delivered, length: ${text.length}`);
      if (text.trim().startsWith('<!DOCTYPE html>')) {
        throw new Error('Received HTML instead of GPX. Possibly 404.');
      }
      handleUpload(text);
    } catch (e: any) {
      console.error("Demo load error:", e);
      alert(`Failed to load demo route: ${e.message}`);
    }
  };

  const basePath = process.env.NEXT_PUBLIC_BASE_PATH || '';

  return (
    <main className="min-h-screen bg-black text-white p-8 font-[family-name:var(--font-geist-sans)]">
      <div className="max-w-6xl mx-auto space-y-8">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-gradient-to-br from-orange-500 to-red-600 rounded-full flex items-center justify-center text-xl font-bold">
              R
            </div>
            <h1 className="text-3xl font-bold tracking-tight">Relive 3D</h1>
          </div>
          {step === 'map' && (
            <button
              onClick={() => {
                setStep('upload');
                // setGpxData removed
              }}
              className="text-sm text-gray-400 hover:text-white transition-colors"
            >
              Upload New File
            </button>
          )}
        </div>

        {step === 'upload' ? (
          <div className="space-y-12">
            <div className="text-center space-y-4 pt-10">
              <h2 className="text-5xl font-extrabold bg-clip-text text-transparent bg-gradient-to-r from-orange-400 to-red-600">
                Visualize Your Run in 3D
              </h2>
              <p className="text-xl text-gray-400 max-w-2xl mx-auto">
                Upload your GPX file and watch your activity come to life with a cinematic 3D flyover.
              </p>
            </div>

            <Uploader onUpload={handleUpload} />

            <div className="text-center space-y-4">
              <p className="text-gray-500 text-sm uppercase tracking-widest font-semibold">Or try a demo</p>

              <div className="flex justify-center space-x-4">
                <button
                  onClick={() => loadDemoRoute(`${basePath}/tokyo-marathon.gpx`)}
                  className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
                >
                  Load Tokyo Marathon Demo
                </button>
                <button
                  onClick={() => loadDemoRoute(`${basePath}/fuji-marathon.gpx`)}
                  className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
                >
                  Load Mt. Fuji Marathon Demo
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex justify-between items-center px-2">
              <h2 className="text-xl font-semibold">Track View</h2>
              <button
                onClick={() => setStep('upload')}
                className="text-sm text-gray-400 hover:text-white underline"
              >
                Upload Another
              </button>
            </div>
            <Map trackGeoJSON={trackGeoJSON} />
          </div>
        )}
      </div>
    </main >
  );
}
