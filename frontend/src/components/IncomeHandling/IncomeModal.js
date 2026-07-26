import { useEffect, useState } from "react";
import "./IncomeModel.css";
import { FaTimes, FaEdit, FaTrash } from "react-icons/fa";
import { expenseAddErrorToast, expenseAddSuccessToast } from "../alertsEffects/toastMessages";
import { FetchingLoader } from "../alertsEffects/FetchingLoader";

export default function IncomeModal({ isOpen, onClose }) {

  const [incomeList, setIncomeList] = useState([]);
  const [loading, setLoading] = useState(false);

  const [isEdit, setIsEdit] = useState(false);
  const [editIncomeId, setEditIncomeId] = useState(null);
  const [updatedAmount, setUpdatedAmount] = useState("");

  const [deleteLoading, setDeleteLoading] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    fetchIncomeSources();
  }, [isOpen]);

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

  const fetchIncomeSources = async () => {
    try {

      setLoading(true);

      const token = localStorage.getItem("token");
      const BASE_URL = process.env.REACT_APP_BACKEND_URL.replace(/\/$/, "");

      const response = await fetch(
        `${BASE_URL}/income/get`,
        {
          method: "GET",
          headers: {
            "Content-Type": "application/json",
            'Authorization': `Bearer ${token}`,
          }
        }
      );

      const data = await response.json();

      if(!response.ok) {
        throw new Error("Failed to fetch income sources");
      }

      if (response.ok) {
        setIncomeList(data.data);
      }

    } catch (error) {
      expenseAddErrorToast({ message: "Failed to fetch income sources." });
      console.log(error);
    } finally {
      setLoading(false);
    }
  };

  const handleEdit = (income) => {
    setIsEdit(true);
    setEditIncomeId(income._id);
  }

  const  handleSaveChanges = async () => {
    try {
      setLoading(true);
      setDeleteLoading(true);
      
      const token = localStorage.getItem("token");
      const BASE_URL = process.env.REACT_APP_BACKEND_URL.replace(/\/$/, "");

      const response = await fetch(
        `${BASE_URL}/income/edit`,
        {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            'Authorization': `Bearer ${token}`,
          },
          body: JSON.stringify({
            incomeId: editIncomeId,
            newAmount: updatedAmount
          })
        }
      );

      if(!response.ok) {
        throw new Error("Failed to update income");
      }

      if (response.ok) {
        expenseAddSuccessToast({ message: "Income updated successfully." });
        fetchIncomeSources();
        setIsEdit(false);
        setEditIncomeId(null);
      }
    } catch (error) {
      expenseAddErrorToast({ message: "Failed to update income." });
      console.log(error);
    } finally {
      setDeleteLoading(false);
      setLoading(false);
    }
  }

  const handleDelete = async (incomeId) => {
    try {
      setLoading(true);

      const token = localStorage.getItem("token");
      const BASE_URL = process.env.REACT_APP_BACKEND_URL.replace(/\/$/, "");

      const response = await fetch(
        `${BASE_URL}/income/delete`,
        {
          method: "DELETE",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ deleteIncomeId: incomeId }),
        }
      );

      if(!response.ok) {
        throw new Error("Failed to delete income");
      }

      const data = await response.json();

      if (response.ok && data.success) {
        expenseAddSuccessToast({ message: "Income deleted successfully." });
        fetchIncomeSources();
      }
    } catch (error) {
      expenseAddErrorToast({ message: "Failed to delete income." });
      console.error(error);
    } finally {
      setLoading(false);
    }
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
                defaultValue={
                  incomeList.find(i => i._id === editIncomeId)?.incomeAmount || ""
                }
                min="0"
                onChange={(e) => setUpdatedAmount(e.target.value)}
              />
            </div>

            <div className="edit-actions">
              <button
                className="cancel-btn"
                onClick={() => {
                  setIsEdit(false);
                  setEditIncomeId(null);
                }}
              >
                Cancel
              </button>

              <button className="save-btn" onClick={() => {handleSaveChanges()}}>
                {deleteLoading ? <FetchingLoader /> : "Save Changes"}
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
            {loading ? (
              <p>Loading...</p>
            ) : incomeList.length === 0 ? (
              <p>No income records found.</p>
            ) : (
              incomeList.map((income) => (

                <div key={income._id} className="income-card">
                  <div className="income-top-row">
                    <span className="income-source">
                      {income.incomeSource}
                    </span>

                    <span className="income-amount">
                      ₹{income.incomeAmount.toLocaleString()}
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
          </div>
        </div>
      }
    </div>
  );
}