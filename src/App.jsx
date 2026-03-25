import { APIProvider } from "@vis.gl/react-google-maps";
import MapComponent from "./components/MapComponent";
import "./App.css";

/**
 * Replace with your actual Google Maps API key.
 * Required APIs: Maps JavaScript API, Places API, Directions API.
 * Required Libraries are loaded dynamically via useMapsLibrary.
 */
const GOOGLE_MAPS_API_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;

function App() {
  return (
    <APIProvider
      apiKey={GOOGLE_MAPS_API_KEY}
      libraries={["visualization", "places", "geometry"]}
    >
      <MapComponent />
    </APIProvider>
  );
}

export default App;
