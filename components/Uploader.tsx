'use client';

import React, { useCallback } from 'react';
import { Upload } from 'lucide-react';

interface UploaderProps {
    onUpload: (content: string) => void;
}

export default function Uploader({ onUpload }: UploaderProps) {
    const handleDrop = useCallback(
        (e: React.DragEvent<HTMLDivElement>) => {
            e.preventDefault();
            const file = e.dataTransfer.files[0];
            if (file && (file.name.endsWith('.gpx') || file.name.endsWith('.xml'))) {
                const reader = new FileReader();
                reader.onload = (event) => {
                    if (event.target?.result) {
                        onUpload(event.target.result as string);
                    }
                };
                reader.readAsText(file);
            }
        },
        [onUpload]
    );

    const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
        e.preventDefault();
    };

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) {
            const reader = new FileReader();
            reader.onload = (event) => {
                if (event.target?.result) {
                    onUpload(event.target.result as string);
                }
            };
            reader.readAsText(file);
        }
    };

    return (
        <div
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            className="border-2 border-dashed border-gray-600 rounded-lg p-10 flex flex-col items-center justify-center text-gray-400 hover:border-blue-500 hover:text-blue-500 transition-colors bg-gray-900/50 backdrop-blur-sm"
        >
            <Upload size={48} className="mb-4" />
            <p className="mb-2 text-lg font-medium">Drag & drop your GPX file here</p>
            <p className="text-sm opacity-70 mb-4">or</p>
            <label className="cursor-pointer bg-blue-600 hover:bg-blue-700 text-white px-6 py-2 rounded-full font-semibold transition-colors">
                Browse Files
                <input
                    type="file"
                    // 修改這裡：加入 MIME types 讓 iOS 知道它是 XML 類型
                    accept=".gpx,.xml,,application/gpx+xml,application/xml,text/xml"
                    className="hidden"
                    onChange={handleFileChange}
                />
            </label>
        </div>
    );
}
