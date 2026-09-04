import { useEffect, useState } from "react";
import "./IncomeModel.css";
import { FaTimes, FaEdit, FaTrash } from "react-icons/fa";
import { expenseAddErrorToast, expenseAddSuccessToast } from "../alertsEffects/toastMessages";
import { FetchingLoader } from "../alertsEffects/FetchingLoader";
import { useInfiniteIncomeQuery } from "../../hooks/queries/useInfiniteIncomeQuery";
import { useUpdateIncomeMutation } from "../../hooks/mutations/useUpdateIncomeMutation";
import { useDeleteIncomeMutation } from "../../hooks/mutations/useDeleteIncomeMutation";

// Modal for viewing, editing, and deleting income records.
export default function IncomeModal({ isOpen, onClose, period }) {

  // EXP-003-T05 -- network-paged instead of the previous unbounded fetch; a "Load more" button (not scroll-triggered, since this list lives inside a modal rather than the page) requests the next page on demand.
  const listQuery = useInfiniteIncomeQuery(period, isOpen);
  const updateMutation = useUpdateIncomeMutation();
  const deleteMutation = useDeleteIncomeMutation();

  const incomeList = (listQuery.data?.pages ?? []).flatMap((page) => (page?.success ? page.data : []));
  const loading = listQuery.isLoading || updateMutation.isPending || deleteMutation.isPending;

  const [isEdit, setIsEdit] = useState(false);
  const [editIncomeId, setEditIncomeId] = useState(null);
  const [updatedAmount, setUpdatedAmount] = useState("");

  useEffect(() => {
    if (!listQuery.isError) return;
    // 401/429/409 are already surfaced by the shared axios interceptor — avoid toasting a second time.
    const status = listQuery.error?.response?.status;
    if (status !== 401 && status !== 429 && status !== 409) {
      expenseAddErrorToast({ message: "Failed to fetch income sources." });
    }
  }, [listQuery.isError, listQuery.error]);

  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = "hidden";
      document.documentElement.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
      document.documentElement.style.overflow = "";
    }

    return () => {
      document.body.style.overflow = "";
      document.documentElement.style.overflow = "";
    };
  }, [isOpen]);

  const handleEdit = (income) => {
    setIsEdit(true);
    setEditIncomeId(income._id);
    // Seeds the controlled input so saving without typing submits the unchanged value, not "".
    setUpdatedAmount(income.incomeAmount ?? "");
  }

  const handleSaveChanges = () => {
    updateMutation.mutate(
      { incomeId: editIncomeId, newAmount: updatedAmount },
      {
        onSuccess: () => {
          expenseAddSuccessToast({ message: "Income updated successfully." });
          setIsEdit(false);
          setEditIncomeId(null);
          setUpdatedAmount("");
        },
        onError: (error) => {
          // 401/429/409 are already surfaced by the shared axios interceptor — avoid toasting a second time.
          const status = error.response?.status;
          if (status !== 401 && status !== 429 && status !== 409) {
            expenseAddErrorToast({ message: "Failed to update income." });
            console.log(error);
          }
        },
      }
    );
  }

  const handleDelete = (incomeId) => {
    deleteMutation.mutate(incomeId, {
      onSuccess: (data) => {
        if (data.success) {
          expenseAddSuccessToast({ message: "Income deleted successfully." });
        }
      },
      onError: (error) => {
        // 401/429/409 are already surfaced by the shared axios interceptor — avoid toasting a second time.
        const status = error.response?.status;
        if (status !== 401 && status !== 429 && status !== 409) {
          expenseAddErrorToast({ message: "Failed to delete income." });
          console.error(error);
        }
      },
    });
  };

  // Falls back to "0" for null/undefined/non-numeric incomeAmount values instead of crashing.
  const formatIncomeAmount = (amount) => {
    const num = Number(amount);
    return Number.isFinite(num) ? num.toLocaleString() : "0";
  };

  const formatDate = (date) =>

    new Date(date).toLocaleDateString(
      "en-IN",
      {
        day: "2-digit",
        month: "short",
        year: "numeric"
      }
    );

  if (!isOpen) return null;

  return (

    <div
        className="income-modal-backdrop"
        onClick={() => {
          onClose();
          setIsEdit(false);
          setUpdatedAmount("");
        }}
    >
      {isEdit ?
        <div
          className="income-modal-edit"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="income-modal-edit-card">
            <h3>Edit Income Amount</h3>

            <div className="amount-input-wrapper">
              <span>₹</span>
              <input
                type="number"
                placeholder="Enter amount"
                value={updatedAmount}
                min="0"
                step="any"
                onChange={(e) => setUpdatedAmount(e.target.value)}
              />
            </div>

            <div className="edit-actions">
              <button
                className="cancel-btn"
                onClick={() => {
                  setIsEdit(false);
                  setEditIncomeId(null);
                  setUpdatedAmount("");
                }}
              >
                Cancel
              </button>

              <button className="save-btn" onClick={() => {handleSaveChanges()}}>
                {updateMutation.isPending ? <FetchingLoader /> : "Save Changes"}
              </button>
            </div>
          </div>
        </div>
        :
        <div className="income-modal" onClick={(e) => e.stopPropagation()}>
          <div className="income-modal-header">
            <h2>Income Sources</h2>
            <button className="income-close-btn" onClick={onClose}>
              <FaTimes  />
            </button>
          </div>

          <div className="income-list">
            {/* FE-001-T08 -- loading/empty text previously had no ARIA role, and
                a failed fetch showed only a transient toast with no persistent,
                retryable in-modal state (see the isError branch below). */}
            {loading ? (
              <p role="status" aria-live="polite">Loading...</p>
            ) : listQuery.isError ? (
              <div className="income-error-block" role="alert" aria-live="assertive">
                <p className="income-error-text">We couldn't load your income sources.</p>
                <button
                  type="button"
                  className="income-load-more"
                  onClick={() => listQuery.refetch()}
                >
                  Retry
                </button>
              </div>
            ) : incomeList.length === 0 ? (
              <p role="status">No income records found.</p>
            ) : (
              incomeList.map((income) => (

                <div key={income._id} className="income-card">
                  <div className="income-top-row">
                    <span className="income-source">
                      {income.incomeSource}
                    </span>

                    <span className="income-amount">
                      ₹{formatIncomeAmount(income.incomeAmount)}
                    </span>
                  </div>

                  <div className="btns-amount">
                    <div className="income-date">
                      {formatDate(income.incomeDate)}
                    </div>
                    <div className="income-actions">
                      <button
                        className="income-action-btn edit"
                        onClick={() => handleEdit(income)}
                      >
                        <FaEdit />
                      </button>

                      <button
                        className="income-action-btn delete"
                        onClick={() => {
                          handleDelete(income._id);
                        }}
                      >
                        <FaTrash />
                      </button>
                    </div>
                  </div>
                </div>
              ))
            )}

            {listQuery.hasNextPage && (
              <button
                type="button"
                className="income-load-more"
                onClick={() => listQuery.fetchNextPage()}
                disabled={listQuery.isFetchingNextPage}
              >
                {listQuery.isFetchingNextPage ? "Loading…" : "Load more"}
              </button>
            )}
          </div>
        </div>
      }
    </div>
  );
}
