import { Routes, Route, Navigate } from "react-router-dom";
import EventPage from "./pages/EventPage.jsx";

export default function App() {
  return (
    <Routes>
      <Route path="/e/:slug" element={<EventPage />} />
      <Route path="*" element={<Navigate to="/e/demo" replace />} />
    </Routes>
  );
}
