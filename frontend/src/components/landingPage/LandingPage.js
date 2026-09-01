import React, { useState, useEffect, useContext } from 'react';
import {
    ThemeContext,
    TrendChartPage,
    BarChartPage,
    PieChartPage,
    ExpensesPage,
    DeleteAlert,
    Insights,
    deleteSuccessToast,
    deleteErrorToast,
    Add
} from '../imports/Imports';
import icons from '../imports/iconsImport';
import { Routes, Route, Link, useLocation } from 'react-router-dom';
import './LandingPage.css';

import { signUpSuccessToast } from '../alertsEffects/toastMessages';
import { FaWallet, FaPlusCircle, FaChartBar, FaSearchDollar, FaSignOutAlt, FaMoon, FaSun, FaWindowClose, FaBars } from "react-icons/fa";
import { useDeleteExpenseMutation } from '../../hooks/mutations/useDeleteExpenseMutation';
import { queryClient } from '../../query/queryClient';

// Main authenticated app shell: header/nav, mobile menus, routed pages, and expense-delete confirmation flow.
const LandingPage = ({ setIsSpinnerLoad, setIsLogout, setIsLoggedIn }) => {
    const { theme, toggleTheme } = useContext(ThemeContext);

    const deleteExpenseMutation = useDeleteExpenseMutation();

    const [confirmDeleteId, setConfirmDeleteId] = useState(null);

    const [showMobileDropdown, setShowMobileDropdown] = useState(false);
    const [isSettingsOpen, setIsSettingsOpen] = useState(false);
    const [isMobile, setIsMobile] = useState(window.innerWidth <= 600);

    // Shared with AddExpense so it can load and edit a specific expense.
    const [isEdit, setIsEdit] = useState({
        enableEdit: false,
        expense_id: ''
    });

    const location = useLocation();

    // Clears edit mode whenever the user navigates away from the Add Expense page.
    useEffect(() => {
    if (location.pathname !== '/add') {
        setIsEdit({ enableEdit: false, expense_id: '' });
    }
    }, [location.pathname]);

    useEffect(() => {
        const handleResize = () => setIsMobile(window.innerWidth <= 600);
        
        window.addEventListener('resize', handleResize);
        return () => window.removeEventListener('resize', handleResize);
    }, []);

    const onDelete = (id) => {
        setConfirmDeleteId(id);
    };

    // Deletes the confirmed expense; the mutation's own invalidation refreshes the expense list and budget totals.
    const confirmDeleteHandler = () => {
        const token = localStorage.getItem('token');
        if (!token) return;

        setIsSpinnerLoad(true);

        deleteExpenseMutation.mutate(confirmDeleteId, {
            // Phase C -- Expense Mutation Reliability: a 2xx here always means
            onSuccess: (data) => {
                deleteSuccessToast(Boolean(data?.derivedData?.recoveryPending));
                setConfirmDeleteId(null);
            },
            onError: (error) => {
                // 401/429/409 are already surfaced by the shared axios interceptor — avoid toasting a second time.
                const status = error.response?.status;
                if (status === 401 || status === 429 || status === 409) {
                    return;
                }

                if (error.response?.data) {
                    deleteErrorToast(error.response.data);
                } else {
                    deleteErrorToast({ message: "Failed to delete expense" });
                }
            },
            onSettled: () => setIsSpinnerLoad(false),
        });
    };

    const cancelDeleteHandler = () => {
        setConfirmDeleteId(null);
    };

    // Chart dropdown links, shared by the desktop nav and mobile dropdown.
    const renderDropdownLinks = () => (
        <>
            <Link
                to="/chart/line"
                className="dropdown-item"
                onClick={() => setShowMobileDropdown(false)}
                >
                Trend Flow
                <img className="icon-button" src={icons.trendChart} alt="icon" />
            </Link>

            <Link
                to="/chart/bar"
                className="dropdown-item"
                onClick={() => setShowMobileDropdown(false)}
                >
                Bars View
                <img className="icon-button" src={icons.barChart} alt="icon" />
            </Link>

            <Link
                to="/chart/pie"
                className="dropdown-item"
                onClick={() => setShowMobileDropdown(false)}
                >
                Pie Scope
                <img className="icon-button" src={icons.pieChart} alt="icon" />
            </Link>
        </>
    );

    const handleLogout = () => {
        localStorage.clear();
        // Clears cached server state so the next login on this tab never sees the previous user's data.
        queryClient.clear();
        const data = {
            "message": "Logged out successfully"
        }
        signUpSuccessToast(data);
        setIsLogout(true);
        setIsLoggedIn(false);
    };

    const renderMobileSettings = () => (
        <div className="mobile-settings-panel">

            <div className="mobile-settings-header">
                <span>Settings</span>

                <button
                className="mobile-settings-close-btn"
                onClick={() => setIsSettingsOpen(false)}
                >
                <FaWindowClose />
                </button>
            </div>

            <div className="mobile-settings-body">

                <button className="toggle-button" onClick={toggleTheme}>
                {theme === "light-theme" ? <FaMoon /> : <FaSun />}
                {theme === "light-theme" ? "Dark Mode" : "Light Mode"}
                </button>

                <button className="logout-button" onClick={handleLogout}>
                <FaSignOutAlt />
                Logout
                </button>

            </div>
        </div>
    );

    return (
        <>
            <div className={`app-container ${theme} ${confirmDeleteId ? 'blur-background' : ''}`}>

                    <header className="app-header">
                        <div className="desktop-header">
                            <div className="app-nav-toggle">
                                <nav className="app-navigation">

                                    <Link className="nav-link" to="/">
                                        <span className="nav-item">
                                            <FaWallet /> Expenses
                                        </span>
                                    </Link>

                                    <Link className="nav-link" to="/add">
                                        <span className="nav-item">
                                            <FaPlusCircle /> Add
                                        </span>
                                    </Link>

                                    <div className="nav-link dropdown">
                                        <span
                                            className="nav-item dropdown-toggle"
                                            onClick={() => {
                                                if (isMobile) setShowMobileDropdown(true);
                                            }}
                                        >
                                            <FaChartBar /> Charts
                                        </span>

                                        {!isMobile && (
                                            <div className="dropdown-menu">
                                                {renderDropdownLinks()}
                                            </div>
                                        )}
                                    </div>

                                    <Link className="nav-link" to="/analysis">
                                        <span className="nav-item">
                                            <FaSearchDollar /> Analysis
                                        </span>
                                    </Link>

                                </nav>

                                <div className="header-buttons">
                                    <button className="toggle-button" onClick={toggleTheme}>
                                        {theme === 'light-theme' ? <FaMoon /> : <FaSun />}
                                        {theme === 'light-theme' ? 'Dark Mode' : 'Light Mode'}
                                    </button>

                                    <button className="logout-button" onClick={handleLogout}>
                                        <FaSignOutAlt /> Logout
                                    </button>
                                </div>
                            </div>
                        </div>

                        <div className="desktop-typewriter">
                                <p>Track your expenses easily!</p>
                        </div>

                        <div className="mobile-header">
                            <div className="typewriter">
                                <p>Track your expenses easily!</p>
                            </div>

                            <button
                                className="mobile-settings"
                                onClick={() => setIsSettingsOpen(true)}
                            >
                                <FaBars />
                            </button>
                        </div>
                    </header>

                    <main className="app-main">
                        <Routes>
                            <Route path="/" element={<ExpensesPage onDelete={onDelete} setIsEdit={setIsEdit} />} />
                            <Route path="/add" element={<Add isEdit={isEdit} setIsEdit={setIsEdit} />} />
                            <Route path="/chart/line" element={<TrendChartPage />} />
                            <Route path="/chart/bar" element={<BarChartPage />} />
                            <Route path="/chart/pie" element={<PieChartPage />} />
                            <Route path="/analysis" element={<Insights />} />
                        </Routes>
                    </main>

                    {isMobile && 
                        <nav className="mobile-bottom-nav">
                            <Link to="/" className={location.pathname === "/" ? "active-nav" : ""}>
                                <FaWallet />
                                <span>Expenses</span>
                            </Link>

                            <Link to="/add" className={location.pathname === "/add" ? "active-nav" : ""}>
                                <FaPlusCircle />
                                <span>Add</span>
                            </Link>

                            <span
                                className="mobile-chart-btn"
                                onClick={() => setShowMobileDropdown(prev => !prev)}
                            >
                                <FaChartBar />
                                <span>Charts</span>
                            </span>
                            
                            <Link to="/analysis" className={location.pathname === "/analysis" ? "active-nav" : ""}>
                                <FaSearchDollar />
                                <span>Analysis</span>
                            </Link>
                        </nav>
                    }

                    {isMobile && showMobileDropdown && (
                        <>
                            <div
                                className="dropdown-overlay mobile-chart-overlay"
                                onClick={() => setShowMobileDropdown(false)}
                            />

                            <div className={`dropdown-menu ${showMobileDropdown ? "mobile-dropdown-modal" : ""}`}>
                                {renderDropdownLinks()}
                            </div>
                        </>
                    )}

                    {isSettingsOpen && 
                        <>
                            <div
                                className="dropdown-overlay"
                                onClick={() => setIsSettingsOpen(false)}
                            />
                            {renderMobileSettings()}
                        </>
                    }
            </div>

            {confirmDeleteId && (
                <DeleteAlert
                    confirmDeleteId={confirmDeleteId}
                    confirmDeleteHandler={confirmDeleteHandler}
                    cancelDeleteHandler={cancelDeleteHandler}
                />
            )}
        </>
    );
};

export default LandingPage;
