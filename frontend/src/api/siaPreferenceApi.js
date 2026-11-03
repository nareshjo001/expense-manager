import api from "./axios";

// Js.

export const getSiaPreference = async (signal) => {
  const { data } = await api.get("/sia/preferences", { signal });
  return data;
};

// `enabled` must be a boolean -- the backend rejects anything else (see
// siaPreferenceService.setEnabled's own validation).
export const updateSiaPreference = async (enabled) => {
  const { data } = await api.put("/sia/preferences", { enabled });
  return data;
};

// Deletes only conversation history (SiaSession + SiaMessage), never the
// enable/disable preference itself -- independent of full account deletion.
export const deleteSiaHistory = async () => {
  const { data } = await api.delete("/sia/history");
  return data;
};
