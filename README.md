# Relive 3D - GPS Track Visualizer

A Next.js application that visualizes GPX tracks on a 3D terrain map using Mapbox GL JS.

## Features

-   **3D Flyover**: Animated camera follows your GPS track over 3D terrain.
-   **Photo Waypoints**: Upload photos and they automatically appear on the map if they match the location and time of your run.
-   **Runner Avatar**: A fun 3D-style emoji runner that moves along the path.
-   **Pace Analysis**: Real-time pace display during the animation.
-   **Demo Data**: Includes Tokyo Marathon and Mt. Fuji Marathon demo tracks.

## Setup

1.  Clone the repository.
2.  Install dependencies:
    ```bash
    npm install
    ```
3.  Create a `.env.local` file with your Mapbox token:
    ```
    NEXT_PUBLIC_MAPBOX_TOKEN=your_token_here
    ```
4.  Run the development server:
    ```bash
    npm run dev
    ```

## Usage

1.  Upload a GPX file (or use a demo).
2.  (Optional) "Add Photos" to upload images from your activity.
3.  Click "Start 3D Flyover" to watch your journey!

