import React, { useState, useEffect, useContext } from 'react';
import {
    ThemeContext,
    TrendChartPage,
    BarChartPage,
    PieChartPage,
    ExpensesPage,
    DeleteAlert,
    BudgetContext,
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

const LandingPage = ({ setIsSpinnerLoad, setIsLogout, setIsLoggedIn }) => {
    // Theme handling (global UI concern)
    const { theme, toggleTheme } = useContext(ThemeContext);
    
    // Budget re-fetch after delete
    const { fetchBudgets } = useContext(BudgetContext);

    // Delete confirmation state
    const [confirmDeleteId, setConfirmDeleteId] = useState(null);
    
    // Mobile UI state
    const [showMobileDropdown, setShowMobileDropdown] = useState(false);
    const [isSettingsOpen, setIsSettingsOpen] = useState(false);
    const [isMobile, setIsMobile] = useState(window.innerWidth <= 600);
    
    // Used to force refresh in ExpensesPage after deletion
    const [refreshFlag, setRefreshFlag] = useState(false);

    // Edit state shared between ExpensesPage and AddExpense
    const [isEdit, setIsEdit] = useState({
        enableEdit: false,
        expense_id: ''
    });

    const location = useLocation();

    // Reset edit mode when navigating away from Add Expense page
    useEffect(() => {
    if (location.pathname !== '/add') {
        setIsEdit({ enableEdit: false, expense_id: '' });
    }
    }, [location.pathname]);

    // Watch window resize to update isMobile dynamically
    useEffect(() => {
        const handleResize = () => setIsMobile(window.innerWidth <= 600);
        
        window.addEventListener('resize', handleResize);
        return () => window.removeEventListener('resize', handleResize);
    }, []);

    // Trigger delete confirmation modal
    const onDelete = (id) => {
        setConfirmDeleteId(id);
    };

    /**
     * Confirms expense deletion
     * - Shows global spinner
     * - Triggers expense + budget refresh
    */
    const confirmDeleteHandler = async () => {
        const token = localStorage.getItem('token');
        if (!token) return;
        
        setIsSpinnerLoad(true);
        
        const BASE_URL = process.env.REACT_APP_BACKEND_URL.replace(/\/$/, "");
        if (!BASE_URL) {
            setIsSpinnerLoad(false);
            return;
        }

        try {
            const response = await fetch(`${BASE_URL}/expense/delete-expense`, {
                method: 'DELETE',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({ id: confirmDeleteId })
            });

            const data = await response.json();

            if (response.ok) {
                deleteSuccessToast();
                setConfirmDeleteId(null);

                // Force ExpensesPage re-fetch
                setRefreshFlag(prev => !prev);

                // Sync budget values
                fetchBudgets();
            } else {
                deleteErrorToast(data);
            }
        } catch (error) {
            deleteErrorToast({ message: "Failed to delete expense" });
        } finally {
            setIsSpinnerLoad(false);
        }
    };

    const cancelDeleteHandler = () => {
        setConfirmDeleteId(null);
    };

    // Dropdown links (reused for desktop and mobile views)
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
            <>
                {/* Theme and delete blur wrapper */}
                <div className={`app-container ${theme} ${confirmDeleteId ? 'blur-background' : ''}`}>
                    
                    {/* Header navigation bar */}
                    <header className="app-header">
                        {/* Desktop Navigation */}
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

                        {/* Mobile Header */}
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

                    {/* Page content rendered via routes */}
                    <main className="app-main">
                        <Routes>
                            <Route path="/" element={<ExpensesPage onDelete={onDelete} refreshFlag={refreshFlag} setIsEdit={setIsEdit} />} />
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
                                className="dropdown-overlay"
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

                {/* Delete confirmation modal */}
                {confirmDeleteId && (
                    <DeleteAlert
                        confirmDeleteId={confirmDeleteId}
                        confirmDeleteHandler={confirmDeleteHandler}
                        cancelDeleteHandler={cancelDeleteHandler}
                    />
                )}
            </>
        </>
    );
};

export default LandingPage;