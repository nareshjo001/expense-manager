import api from "./axios";

// Thin wrapper over the /bills route, routed through the shared axios instance for centralized auth/error handling.

export const uploadBill = async (file, signal) => {
  const formData = new FormData();
  formData.append("bill", file);

  // Content-Type is intentionally left unset so axios/the browser generates the multipart boundary for FormData.
  const { data } = await api.post("/bills/bill-upload", formData, { signal });
  return data;
};
