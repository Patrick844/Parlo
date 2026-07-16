/** Route map. Admin pages sit inside AdminLayout (which enforces login). */

import { BrowserRouter, Route, Routes } from "react-router-dom";

import AdminLayout from "./components/AdminLayout";
import Chat from "./pages/Chat";
import Dashboard from "./pages/Dashboard";
import FormEditor from "./pages/FormEditor";
import InsightsPage from "./pages/InsightsPage";
import Login from "./pages/Login";

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route
          path="/"
          element={
            <AdminLayout>
              <Dashboard />
            </AdminLayout>
          }
        />
        <Route
          path="/forms/:id/edit"
          element={
            <AdminLayout>
              <FormEditor />
            </AdminLayout>
          }
        />
        <Route
          path="/forms/:id/insights"
          element={
            <AdminLayout>
              <InsightsPage />
            </AdminLayout>
          }
        />
        {/* Public respondent page — no auth, this is the link creators share. */}
        <Route path="/f/:slug" element={<Chat />} />
      </Routes>
    </BrowserRouter>
  );
}
