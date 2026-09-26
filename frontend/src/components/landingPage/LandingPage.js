import React, { useState, useEffect, useContext, Suspense, lazy } from 'react';
import { onKeyActivate } from '../../utils/onKeyActivate';
import {
    ThemeContext,
    ExpensesPage,
    DeleteAlert,
    deleteSuccessToast,
    deleteErrorToast,
    Add,
    MerchantRules,
    RecurringPage,
    NotificationPreferences,
    SiaPreferences,
    DataExport,
    ReceiptInbox,
    ImportWizard
} from '../imports/Imports';
import icons from '../imports/iconsImport';
import { Routes, Route, Link, useLocation, useNavigate } from 'react-router-dom';
import './LandingPage.css';

import { signUpSuccessToast } from '../alertsEffects/toastMessages';
import { FaWallet, FaPlusCircle, FaChartBar, FaSearchDollar, FaSignOutAlt, FaMoon, FaSun, FaWindowClose, FaBars, FaTags, FaSyncAlt, FaBell, FaFileExport, FaReceipt, FaFileImport, FaRobot } from "react-icons/fa";
import { useDeleteExpenseMutation } from '../../hooks/mutations/useDeleteExpenseMutation';
import { queryClient } from '../../query/queryClient';
import { getAccessToken, logoutSession } from '../../api/sessionClient';

// FE-003-T03 -- lazy-loaded route-level pages.
//
// These four are the heaviest thing this app ships (recharts + its d3
// sub-dependencies for the three chart pages, the AI-insights machinery for
// Insights) and, before this, all four downloaded as part of the MAIN bundle
// on every login even for a session that never opens a chart. Importing them
// directly here -- not through '../imports/Imports' -- is required: a lazy()
// call needs its own dynamic import() so webpack can split it into a
// separate chunk; going through the barrel would just re-bundle it with
// everything else the barrel re-exports. (The barrel's own imports of these
// four are removed in the same change -- see Imports.js -- otherwise App.js's
// eager import of the barrel would still pull them into main.)
//
// FE-003-T06 -- each loader is its own named function (not inlined into
// lazy()) so the exact same function can be called early, on hover/focus of
// the link that leads to it (see prefetch* below): webpack's import() cache
// is keyed on the module, so calling the loader again once React actually
// renders the route is a no-op cache hit instead of a second network
// request -- the chunk is already downloading (or done) by the time it's
// needed, without changing what gets rendered or when.
const loadTrendChartPage = () => import(/* webpackChunkName: "charts" */ '../charts/linechart/TrendChartPage');
const loadBarChartPage = () => import(/* webpackChunkName: "charts" */ '../charts/barchart/BarChartPage');
const loadPieChartPage = () => import(/* webpackChunkName: "charts" */ '../charts/piechart/PieChartPage');
const loadInsights = () => import(/* webpackChunkName: "insights" */ '../monthlyInsights/Insights');
const TrendChartPage = lazy(loadTrendChartPage);
const BarChartPage = lazy(loadBarChartPage);
const PieChartPage = lazy(loadPieChartPage);
const Insights = lazy(loadInsights);

// Fires all three chart loaders at once -- cheap (webpack dedupes/caches),
// and simpler than tracking which single chart link was hovered.
const prefetchCharts = () => {
    loadTrendChartPage();
    loadBarChartPage();
    loadPieChartPage();
};

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
    const navigate = useNavigate();

    // REC-003-T05 -- the upcoming-recurring view's "Edit" action opens the
    // underlying historical expense (see UpcomingRecurring.js's own header
    // comment on why that is a real, but different, action from editing the
    // recurring definition itself). Same enableEdit/navigate pattern
    // ExpenseItem.js already uses for the identical action from the
    // expenses list.
    const handleEditFromRecurring = (expenseId) => {
        setIsEdit({ enableEdit: true, expense_id: expenseId });
        navigate('/add');
    };

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
        const token = getAccessToken();
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
                onMouseEnter={loadTrendChartPage}
                onFocus={loadTrendChartPage}
                onTouchStart={loadTrendChartPage}
                >
                Trend Flow
                <img className="icon-button" src={icons.trendChart} alt="icon" />
            </Link>

            <Link
                to="/chart/bar"
                className="dropdown-item"
                onClick={() => setShowMobileDropdown(false)}
                onMouseEnter={loadBarChartPage}
                onFocus={loadBarChartPage}
                onTouchStart={loadBarChartPage}
                >
                Bars View
                <img className="icon-button" src={icons.barChart} alt="icon" />
            </Link>

            <Link
                to="/chart/pie"
                className="dropdown-item"
                onClick={() => setShowMobileDropdown(false)}
                onMouseEnter={loadPieChartPage}
                onFocus={loadPieChartPage}
                onTouchStart={loadPieChartPage}
                >
                Pie Scope
                <img className="icon-button" src={icons.pieChart} alt="icon" />
            </Link>
        </>
    );

    const handleLogout = async () => {
        await logoutSession();
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
                                            role="button"
                                            tabIndex={0}
                                            aria-haspopup="true"
                                            aria-expanded={isMobile ? showMobileDropdown : undefined}
                                            onClick={() => {
                                                if (isMobile) setShowMobileDropdown(true);
                                            }}
                                            onKeyDown={onKeyActivate(() => {
                                                if (isMobile) setShowMobileDropdown(true);
                                            })}
                                            onMouseEnter={prefetchCharts}
                                            onFocus={prefetchCharts}
                                            onTouchStart={prefetchCharts}
                                        >
                                            <FaChartBar /> Charts
                                        </span>

                                        {!isMobile && (
                                            <div className="dropdown-menu">
                                                {renderDropdownLinks()}
                                            </div>
                                        )}
                                    </div>

                                    <Link
                                        className="nav-link"
                                        to="/analysis"
                                        onMouseEnter={loadInsights}
                                        onFocus={loadInsights}
                                        onTouchStart={loadInsights}
                                    >
                                        <span className="nav-item">
                                            <FaSearchDollar /> Analysis
                                        </span>
                                    </Link>

                                    <Link className="nav-link" to="/rules">
                                        <span className="nav-item">
                                            <FaTags /> Rules
                                        </span>
                                    </Link>

                                    <Link className="nav-link" to="/recurring">
                                        <span className="nav-item">
                                            <FaSyncAlt /> Recurring
                                        </span>
                                    </Link>

                                    <Link className="nav-link" to="/notification-preferences">
                                        <span className="nav-item">
                                            <FaBell /> Notifications
                                        </span>
                                    </Link>

                                    <Link className="nav-link" to="/sia-settings">
                                        <span className="nav-item">
                                            <FaRobot /> SIA Settings
                                        </span>
                                    </Link>

                                    <Link className="nav-link" to="/export">
                                        <span className="nav-item">
                                            <FaFileExport /> Export
                                        </span>
                                    </Link>

                                    <Link className="nav-link" to="/receipts">
                                        <span className="nav-item">
                                            <FaReceipt /> Receipts
                                        </span>
                                    </Link>

                                    <Link className="nav-link" to="/import">
                                        <span className="nav-item">
                                            <FaFileImport /> Import
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
                        {/* FE-003-T03/T06 -- only the four lazy routes above can actually
                            suspend; the other routes render synchronously as before and
                            never show this fallback. role="status"/aria-live so a screen
                            reader announces the wait instead of going silent. */}
                        <Suspense fallback={<div className="route-loading" role="status" aria-live="polite">Loading…</div>}>
                            <Routes>
                                <Route path="/" element={<ExpensesPage onDelete={onDelete} setIsEdit={setIsEdit} />} />
                                <Route path="/add" element={<Add isEdit={isEdit} setIsEdit={setIsEdit} />} />
                                <Route path="/chart/line" element={<TrendChartPage />} />
                                <Route path="/chart/bar" element={<BarChartPage />} />
                                <Route path="/chart/pie" element={<PieChartPage />} />
                                <Route path="/analysis" element={<Insights />} />
                                <Route path="/rules" element={<MerchantRules />} />
                                <Route path="/recurring" element={<RecurringPage onEditExpense={handleEditFromRecurring} />} />
                                <Route path="/notification-preferences" element={<NotificationPreferences />} />
                                <Route path="/sia-settings" element={<SiaPreferences />} />
                                <Route path="/export" element={<DataExport />} />
                                <Route path="/receipts" element={<ReceiptInbox />} />
                                <Route path="/import" element={<ImportWizard />} />
                            </Routes>
                        </Suspense>
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
                                role="button"
                                tabIndex={0}
                                aria-haspopup="true"
                                aria-expanded={showMobileDropdown}
                                onClick={() => setShowMobileDropdown(prev => !prev)}
                                onKeyDown={onKeyActivate(() => setShowMobileDropdown(prev => !prev))}
                                onTouchStart={prefetchCharts}
                            >
                                <FaChartBar />
                                <span>Charts</span>
                            </span>
                            
                            <Link
                                to="/analysis"
                                className={location.pathname === "/analysis" ? "active-nav" : ""}
                                onTouchStart={loadInsights}
                            >
                                <FaSearchDollar />
                                <span>Analysis</span>
                            </Link>

                            <Link to="/rules" className={location.pathname === "/rules" ? "active-nav" : ""}>
                                <FaTags />
                                <span>Rules</span>
                            </Link>

                            <Link to="/recurring" className={location.pathname === "/recurring" ? "active-nav" : ""}>
                                <FaSyncAlt />
                                <span>Recurring</span>
                            </Link>

                            <Link to="/notification-preferences" className={location.pathname === "/notification-preferences" ? "active-nav" : ""}>
                                <FaBell />
                                <span>Notifications</span>
                            </Link>

                            <Link to="/sia-settings" className={location.pathname === "/sia-settings" ? "active-nav" : ""}>
                                <FaRobot />
                                <span>SIA Settings</span>
                            </Link>

                            <Link to="/export" className={location.pathname === "/export" ? "active-nav" : ""}>
                                <FaFileExport />
                                <span>Export</span>
                            </Link>

                            <Link to="/receipts" className={location.pathname === "/receipts" ? "active-nav" : ""}>
                                <FaReceipt />
                                <span>Receipts</span>
                            </Link>

                            <Link to="/import" className={location.pathname === "/import" ? "active-nav" : ""}>
                                <FaFileImport />
                                <span>Import</span>
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
