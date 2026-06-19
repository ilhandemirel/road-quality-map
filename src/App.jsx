import { BrowserRouter, Routes, Route } from "react-router-dom";
import { APIProvider } from "@vis.gl/react-google-maps";
import { Analytics } from "@vercel/analytics/react";
import { AdminProvider } from "./context/AdminContext";
import MapComponent from "./components/MapComponent";
import AdminLogin from "./components/AdminLogin";
import "./App.css";

/**
 * Replace with your actual Google Maps API key.
 * Required APIs: Maps JavaScript API, Places API, Directions API.
 * Required Libraries are loaded dynamically via useMapsLibrary.
 */
const GOOGLE_MAPS_API_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;

const BASENAME = '/';

function App() {
  return (
    <>
      <BrowserRouter basename={BASENAME}>
        <AdminProvider>
          <APIProvider
            apiKey={GOOGLE_MAPS_API_KEY}
            libraries={["visualization", "places", "geometry"]}
          >
            <Routes>
              <Route path="/" element={<MapComponent />} />
              <Route path="/admin" element={<AdminLogin />} />
            </Routes>
          </APIProvider>
        </AdminProvider>
      </BrowserRouter>
      <Analytics />
    </>
  );
}

export default App;
