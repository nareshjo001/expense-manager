import { toast } from 'react-toastify';

// Preconfigured react-toastify variants for auth, expense, and income feedback messages.
const loginSuccessToast = (data = {}) => {
    toast.dismiss();
    toast.success(
        <div style={{ fontSize: '0.9em', marginTop: '4px' }}>
            Welcome {data.firstname}
        </div>,
        {
            position: "bottom-left",
            autoClose: 3000,
            closeOnClick: true,
            pauseOnHover: true,
            draggable: true,
            style: {
                background: "linear-gradient(145deg, #d1fae5, #a7f3d0)",
                color: "#065f46",
                borderRadius: "12px",
                fontSize: "1rem",
                fontWeight: "500",
                boxShadow: "0 4px 15px rgba(0,0,0,0.15)",
                maxWidth: "250px",
                padding: "12px 20px",
                border: "1px solid rgba(6, 95, 70, 0.3)",
            },
            containerId: "below-header",
        }
    );
};

const logInErrorToast = (data = {}) => {
    toast.dismiss();
    toast.error(
        <div>
            <div style={{ fontSize: '0.9em', marginTop: '4px' }}>
                {data.message} !
            </div>
        </div>,
        {
            position: "top-right",
            autoClose: 3000,
            closeOnClick: true,
            pauseOnHover: true,
            draggable: true,
            style: {
                backgroundColor: "#fee2e2",
                color: "#991b1b",
                borderRadius: "12px",
                fontSize: "1rem",
                fontWeight: "500",
            },
            containerId: "below-header",
        }
    );
};

const signUpSuccessToast = (data = {}) => {
    toast.dismiss();
    toast.success(
        <div>
        <div style={{ fontSize: '0.9em', marginTop: '4px' }}>
            {data.message}
        </div>
        </div>,
        {
            position: "top-right",
            autoClose: 3000,
            closeOnClick: true,
            pauseOnHover: true,
            draggable: true,
            style: {
                background: "linear-gradient(145deg, #d1fae5, #a7f3d0)",
                color: "#065f46",
                borderRadius: "12px",
                fontSize: "1rem",
                fontWeight: "500",
            },
            containerId: "below-header",
        }
    );
};

const signUpErrorToast = (data = {}) => {
    toast.dismiss();
    toast.error(
        <div>
            <div style={{ fontSize: '0.9em', marginTop: '4px' }}>
                {data.message}
            </div>
        </div>,
        {
            position: "top-right",
            autoClose: 3000,
            closeOnClick: true,
            pauseOnHover: true,
            draggable: true,
            style: {
                backgroundColor: "#fee2e2",
                color: "#991b1b",
                borderRadius: "12px",
                fontSize: "1rem",
                fontWeight: "500",
            },
            containerId: "below-header",
        }
    );
};

const expenseAddSuccessToast = (data = {}) => {
    toast.dismiss();
    toast.success(
        <div style={{ fontSize: '0.9em', marginTop: '4px' }}>
            {data.message}!
        </div>,
        {
            position: "top-right",
            autoClose: 3000,
            closeOnClick: true,
            pauseOnHover: true,
            draggable: true,
            style: {
                background: "linear-gradient(145deg, #d1fae5, #a7f3d0)",
                color: "#065f46",
                borderRadius: "12px",
                fontSize: "1rem",
                fontWeight: "500",
            },
            containerId: "below-header",
        }
    );
};

const expenseAddErrorToast = (data = {}) => {
    toast.dismiss();
    toast.error(
        <div>
            <div style={{ fontSize: '0.9em', marginTop: '4px' }}>
                {data.message}
            </div>
        </div>,
        {
            position: "top-right",
            autoClose: 3000,
            closeOnClick: true,
            pauseOnHover: true,
            draggable: true,
            style: {
                backgroundColor: "#fee2e2",
                color: "#991b1b",
                borderRadius: "12px",
                fontSize: "1rem",
                fontWeight: "500",
            },
            containerId: "below-header",
        }
    );
};

const deleteSuccessToast = () => {
    toast.dismiss();
    toast.success(
        <div>
        <div style={{ fontSize: '0.9em', marginTop: '4px' }}>
                Deleted Successfully!
        </div>
        </div>,
        {
            position: "top-right",
            autoClose: 3000,
            closeOnClick: true,
            pauseOnHover: true,
            draggable: true,
            style: {
                background: "linear-gradient(145deg, #d1fae5, #a7f3d0)",
                color: "#065f46",
                borderRadius: "12px",
                fontSize: "1rem",
                fontWeight: "500",
            },
            containerId: "below-header",
        }
    );
};

const deleteErrorToast = () => {
    toast.dismiss();
    toast.error(
        <div>
            <div style={{ fontSize: '0.9em', marginTop: '4px' }}>
                Deletion Failed!
            </div>
        </div>,
        {
            position: "top-right",
            autoClose: 3000,
            closeOnClick: true,
            pauseOnHover: true,
            draggable: true,
            style: {
                backgroundColor: "#fee2e2",
                color: "#991b1b",
                borderRadius: "12px",
                fontSize: "1rem",
                fontWeight: "500",
            },
            containerId: "below-header",
        }
    );
};

export {
    loginSuccessToast,
    logInErrorToast,
    signUpSuccessToast,
    signUpErrorToast,
    expenseAddSuccessToast,
    expenseAddErrorToast,
    deleteSuccessToast,
    deleteErrorToast
};