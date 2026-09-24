import api from "./axios";

// OCR-004 -- thin wrapper over the receipt-inbox routes, through the shared
// axios instance (auth refresh / 401/429 handling stays centralized there,
// same convention as recurringApi.js/exportApi.js/notificationPreferencesApi.js).
//
// Every receipt-inbox endpoint answers with this app's usual
// { message, success, data, errorCode? } envelope -- same shape
// listExportRequests/listRecurringDefinitions/getNotificationPreferences
// already return -- so every wrapper below just hands back `data` (the
// envelope itself) and lets the caller unwrap `.success`/`.data`, exactly
// like those existing wrappers do.

// `linked` is left out of `params` entirely when it isn't a boolean, so an
// unset filter never sends `linked=undefined` on the wire.
export const listReceipts = async ({ reviewStatus, linked } = {}, signal) => {
  const { data } = await api.get("/api/receipts", {
    params: {
      ...(reviewStatus ? { reviewStatus } : {}),
      ...(typeof linked === "boolean" ? { linked } : {}),
    },
    signal,
  });
  return data;
};

export const getReceipt = async (id, signal) => {
  const { data } = await api.get(`/api/receipts/${id}`, { signal });
  return data;
};

// 400 { message, success:false, errorCode } on EXPENSE_NOT_FOUND /
// ALREADY_LINKED_TO_ANOTHER_EXPENSE -- left for the caller (see
// useLinkReceiptMutation / ReceiptDetail.js's onError) to map to a message,
// same split every other mutation wrapper in this app uses.
export const linkReceipt = async (id, expenseId) => {
  const { data } = await api.post(`/api/receipts/${id}/link`, { expenseId });
  return data;
};

// Idempotent per the contract -- unlinking an already-unlinked receipt is
// still a 200, not an error, so callers never need to guard this call on
// the receipt's current linkedExpenseId.
export const unlinkReceipt = async (id) => {
  const { data } = await api.post(`/api/receipts/${id}/unlink`);
  return data;
};

// `corrections` is optional on the contract -- omitted entirely (not sent
// as `{ corrections: undefined }`) when there's nothing to correct, so a
// plain "mark as reviewed" and a "mark as reviewed with these fixes" look
// identical to the server except for whether the key is present at all.
export const markReceiptReviewed = async (id, corrections) => {
  const { data } = await api.post(
    `/api/receipts/${id}/reviewed`,
    corrections && Object.keys(corrections).length > 0 ? { corrections } : {}
  );
  return data;
};

export const deleteReceipt = async (id) => {
  const { data } = await api.delete(`/api/receipts/${id}`);
  return data;
};

// Fetches a receipt's image as a Blob through the authenticated axios
// instance, rather than pointing a plain <img src> at it directly. This app
// authenticates API calls with a bearer token attached per-request (see
// axios.js's request interceptor) -- not a session cookie -- and a plain
// <img> load is a browser-native request that never carries a custom
// Authorization header, so it would 401 against an endpoint guarded the
// same way as every other route here. Same Blob-through-axios shape
// exportApi.js's createExport already uses for its file-download path; the
// caller (ReceiptInbox.js's thumbnail, ReceiptDetail.js's full image) turns
// the Blob into a local object URL with URL.createObjectURL and revokes it
// on unmount/imageUrl change, the same createObjectURL/revokeObjectURL
// pairing BillUpload.js's own preview already uses.
export const getReceiptImageBlob = async (imageUrl, signal) => {
  const response = await api.get(imageUrl, { responseType: "blob", signal });
  return response.data;
};

// OCR-005 -- fetches this receipt's possible duplicate candidates (exact
// file matches and probable merchant/date/amount matches), same envelope
// shape as every other receipt-inbox endpoint above -- empty `data` array
// is the normal "nothing found" case, not an error.
export const getReceiptDuplicates = async (id, signal) => {
  const { data } = await api.get(`/api/receipts/${id}/duplicates`, { signal });
  return data;
};

// Records the user's decision on a receipt's duplicate candidates --
// either keeping it as its own receipt ("confirmed_new") or linking it to
// an existing receipt it duplicates ("linked_existing", which also needs
// `duplicateOfReceiptId`). `duplicateOfReceiptId` is only sent when the
// caller actually passes one, same optional-field omission convention
// markReceiptReviewed's `corrections` uses above.
export const recordDuplicateDecision = async (id, { decision, duplicateOfReceiptId } = {}) => {
  const { data } = await api.post(`/api/receipts/${id}/duplicate-decision`, {
    decision,
    ...(duplicateOfReceiptId ? { duplicateOfReceiptId } : {}),
  });
  return data;
};
