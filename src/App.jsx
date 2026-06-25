import { BrowserRouter, Routes, Route } from "react-router-dom";
import { APIProvider } from "@vis.gl/react-google-maps";
import { Analytics } from "@vercel/analytics/react";
import { AdminProvider } from "./context/AdminContext";
import MapComponent from "./components/MapComponent";
import LeafletMapComponent from "./components/LeafletMapComponent";
import AdminLogin from "./components/AdminLogin";
import "./App.css";

const GOOGLE_MAPS_API_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;
const MAP_PROVIDER = import.meta.env.VITE_MAP_PROVIDER || "google";

const BASENAME = '/';

function App() {
  return (
    <>
      <BrowserRouter basename={BASENAME}>
        <AdminProvider>
          {MAP_PROVIDER === "google" ? (
            <APIProvider
              apiKey={GOOGLE_MAPS_API_KEY}
              libraries={["visualization", "places", "geometry"]}
            >
              <Routes>
                <Route path="/" element={<MapComponent />} />
                <Route path="/admin" element={<AdminLogin />} />
              </Routes>
            </APIProvider>
          ) : (
            <Routes>
              <Route path="/" element={<LeafletMapComponent />} />
              <Route path="/admin" element={<AdminLogin />} />
            </Routes>
          )}
        </AdminProvider>
      </BrowserRouter>
      <Analytics />
    </>
  );
}

export default App;
