import React, { useState, useEffect, useContext, Suspense, lazy, useRef } from 'react';
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
    ReceiptInbox,
    DataTransfer
} from '../imports/Imports';
import icons from '../imports/iconsImport';
import { Routes, Route, Link, useLocation, useNavigate } from 'react-router-dom';
import './LandingPage.css';
import appLogoPink from '../../icons/Logo Pink.png';
import appLogoDark from '../../icons/Logo Dark.png';

import { signUpSuccessToast } from '../alertsEffects/toastMessages';
import { FaWallet, FaPlusCircle, FaChartBar, FaChartPie, FaSearchDollar, FaSignOutAlt, FaMoon, FaSun, FaTags, FaSyncAlt, FaBell, FaReceipt, FaRobot, FaAngleDoubleLeft, FaAngleDoubleRight, FaExchangeAlt, FaCog, FaChevronRight, FaTimes } from "react-icons/fa";
import { useDeleteExpenseMutation } from '../../hooks/mutations/useDeleteExpenseMutation';
import { queryClient } from '../../query/queryClient';
import { getAccessToken, logoutSession } from '../../api/sessionClient';
import BudgetsPage from '../expensesHandling/budget/BudgetsPage';

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

    // UI-REDESIGN desktop-header-sidebar -- desktop-only sidebar collapse
    // state. Purely local/visual: does not affect routing, mobile layout,
    // or any other existing behavior.
    const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
    const [chartsFlyoutCoords, setChartsFlyoutCoords] = useState(null);
    const chartsDropdownRef = useRef(null);

    const updateChartsCoords = () => {
        if (chartsDropdownRef.current) {
            const rect = chartsDropdownRef.current.getBoundingClientRect();
            setChartsFlyoutCoords({
                top: rect.top,
                left: isSidebarCollapsed ? rect.right + 12 : rect.left + 106
            });
        }
    };

    // Shared with AddExpense so it can load and edit a specific expense.
    const [isEdit, setIsEdit] = useState({
        enableEdit: false,
        expense_id: ''
    });

    const location = useLocation();
    const navigate = useNavigate();

    // UI-REDESIGN desktop-header-sidebar -- active-destination highlighting
    // for the new sidebar, based on the real current route. The desktop nav
    // previously had no active-state concept at all (only the mobile bottom
    // nav did, via its own inline location.pathname checks below).
    const isRouteActive = (path) => location.pathname === path;
    // "Charts" has no single route of its own (it fans out to /chart/line,
    // /chart/bar, /chart/pie), so its active state covers any chart route.
    const isChartsActive = location.pathname.startsWith('/chart');
    const [isChartsMenuOpen, setIsChartsMenuOpen] = useState(isChartsActive);

    useEffect(() => {
        if (isChartsActive) {
            setIsChartsMenuOpen(true);
        }
    }, [isChartsActive]);

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

    useEffect(() => {
        if (isSettingsOpen) {
            document.body.classList.add('mobile-settings-open');
        } else {
            document.body.classList.remove('mobile-settings-open');
        }
        return () => {
            document.body.classList.remove('mobile-settings-open');
        };
    }, [isSettingsOpen]);

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
                onClick={() => { setShowMobileDropdown(false); setIsSettingsOpen(false); }}
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
                onClick={() => { setShowMobileDropdown(false); setIsSettingsOpen(false); }}
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
                onClick={() => { setShowMobileDropdown(false); setIsSettingsOpen(false); }}
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
        <aside
            className="mobile-settings-panel"
            role="dialog"
            aria-modal="true"
            aria-label="Settings and Menu"
        >
            <div className="mobile-settings-header">
                <div className="mobile-settings-heading-group">
                    <span className="mobile-settings-accent-bar" aria-hidden="true" />
                    <h2 className="mobile-settings-heading">Settings & Menu</h2>
                </div>

                <button
                    type="button"
                    className="mobile-settings-close-btn"
                    onClick={() => setIsSettingsOpen(false)}
                    aria-label="Close menu"
                    title="Close menu"
                >
                    <FaTimes aria-hidden="true" />
                </button>
            </div>

            <div className="mobile-settings-body">
                <nav className="mobile-menu-nav" aria-label="Mobile navigation">
                    <div className="mobile-menu-section">
                        <span className="mobile-menu-group-label">INSIGHTS</span>

                        <div className="mobile-menu-group">
                            <button
                                type="button"
                                className={`mobile-menu-item mobile-menu-dropdown-toggle ${isChartsActive ? 'active-menu-item' : ''}`}
                                onClick={() => setIsChartsMenuOpen((prev) => !prev)}
                                aria-expanded={isChartsMenuOpen}
                                aria-label="Toggle Charts options"
                            >
                                <div className="mobile-menu-item-content">
                                    <div className="mobile-menu-icon-box">
                                        <FaChartBar className="mobile-menu-item-icon" />
                                    </div>
                                    <div className="mobile-menu-item-texts">
                                        <span className="mobile-menu-item-title">Charts</span>
                                        <span className="mobile-menu-item-desc">Visualize your spending</span>
                                    </div>
                                </div>
                                <span className={`mobile-menu-chevron ${isChartsMenuOpen ? 'open' : ''}`} aria-hidden="true">
                                    <FaChevronRight />
                                </span>
                            </button>

                            {isChartsMenuOpen && (
                                <div className="mobile-menu-subitems" role="region" aria-label="Chart options">
                                    <Link
                                        to="/chart/line"
                                        className={`mobile-menu-subitem ${isRouteActive('/chart/line') ? 'active-subitem' : ''}`}
                                        onClick={() => setIsSettingsOpen(false)}
                                        onTouchStart={loadTrendChartPage}
                                        onMouseEnter={loadTrendChartPage}
                                    >
                                        <div className="mobile-subitem-content">
                                            <img className="icon-button" src={icons.trendChart} alt="" aria-hidden="true" />
                                            <span>Trend Flow</span>
                                        </div>
                                    </Link>

                                    <Link
                                        to="/chart/bar"
                                        className={`mobile-menu-subitem ${isRouteActive('/chart/bar') ? 'active-subitem' : ''}`}
                                        onClick={() => setIsSettingsOpen(false)}
                                        onTouchStart={loadBarChartPage}
                                        onMouseEnter={loadBarChartPage}
                                    >
                                        <div className="mobile-subitem-content">
                                            <img className="icon-button" src={icons.barChart} alt="" aria-hidden="true" />
                                            <span>Bars View</span>
                                        </div>
                                    </Link>

                                    <Link
                                        to="/chart/pie"
                                        className={`mobile-menu-subitem ${isRouteActive('/chart/pie') ? 'active-subitem' : ''}`}
                                        onClick={() => setIsSettingsOpen(false)}
                                        onTouchStart={loadPieChartPage}
                                        onMouseEnter={loadPieChartPage}
                                    >
                                        <div className="mobile-subitem-content">
                                            <img className="icon-button" src={icons.pieChart} alt="" aria-hidden="true" />
                                            <span>Pie Scope</span>
                                        </div>
                                    </Link>
                                </div>
                            )}
                        </div>

                        <Link
                            to="/analysis"
                            className={`mobile-menu-item ${isRouteActive('/analysis') ? 'active-menu-item' : ''}`}
                            onClick={() => setIsSettingsOpen(false)}
                            onTouchStart={loadInsights}
                            onMouseEnter={loadInsights}
                        >
                            <div className="mobile-menu-item-content">
                                <div className="mobile-menu-icon-box">
                                    <FaSearchDollar className="mobile-menu-item-icon" />
                                </div>
                                <div className="mobile-menu-item-texts">
                                    <span className="mobile-menu-item-title">Analysis</span>
                                    <span className="mobile-menu-item-desc">Get spending insights</span>
                                </div>
                            </div>
                            <span className="mobile-menu-chevron" aria-hidden="true">
                                <FaChevronRight />
                            </span>
                        </Link>
                    </div>

                    <div className="mobile-menu-section">
                        <span className="mobile-menu-group-label">MANAGEMENT</span>

                        <Link
                            to="/rules"
                            className={`mobile-menu-item ${isRouteActive('/rules') ? 'active-menu-item' : ''}`}
                            onClick={() => setIsSettingsOpen(false)}
                        >
                            <div className="mobile-menu-item-content">
                                <div className="mobile-menu-icon-box">
                                    <FaTags className="mobile-menu-item-icon" />
                                </div>
                                <div className="mobile-menu-item-texts">
                                    <span className="mobile-menu-item-title">Rules</span>
                                    <span className="mobile-menu-item-desc">Manage merchant rules</span>
                                </div>
                            </div>
                            <span className="mobile-menu-chevron" aria-hidden="true">
                                <FaChevronRight />
                            </span>
                        </Link>

                        <Link
                            to="/recurring"
                            className={`mobile-menu-item ${isRouteActive('/recurring') ? 'active-menu-item' : ''}`}
                            onClick={() => setIsSettingsOpen(false)}
                        >
                            <div className="mobile-menu-item-content">
                                <div className="mobile-menu-icon-box">
                                    <FaSyncAlt className="mobile-menu-item-icon" />
                                </div>
                                <div className="mobile-menu-item-texts">
                                    <span className="mobile-menu-item-title">Recurring</span>
                                    <span className="mobile-menu-item-desc">Manage recurring expenses</span>
                                </div>
                            </div>
                            <span className="mobile-menu-chevron" aria-hidden="true">
                                <FaChevronRight />
                            </span>
                        </Link>

                        <Link
                            to="/data-transfer"
                            className={`mobile-menu-item ${isRouteActive('/data-transfer') || isRouteActive('/import') || isRouteActive('/export') ? 'active-menu-item' : ''}`}
                            onClick={() => setIsSettingsOpen(false)}
                        >
                            <div className="mobile-menu-item-content">
                                <div className="mobile-menu-icon-box">
                                    <FaExchangeAlt className="mobile-menu-item-icon" />
                                </div>
                                <div className="mobile-menu-item-texts">
                                    <span className="mobile-menu-item-title">Data Transfer</span>
                                    <span className="mobile-menu-item-desc">Import or export your data</span>
                                </div>
                            </div>
                            <span className="mobile-menu-chevron" aria-hidden="true">
                                <FaChevronRight />
                            </span>
                        </Link>

                        <Link
                            to="/receipts"
                            className={`mobile-menu-item ${isRouteActive('/receipts') ? 'active-menu-item' : ''}`}
                            onClick={() => setIsSettingsOpen(false)}
                        >
                            <div className="mobile-menu-item-content">
                                <div className="mobile-menu-icon-box">
                                    <FaReceipt className="mobile-menu-item-icon" />
                                </div>
                                <div className="mobile-menu-item-texts">
                                    <span className="mobile-menu-item-title">Receipts</span>
                                    <span className="mobile-menu-item-desc">View and manage receipts</span>
                                </div>
                            </div>
                            <span className="mobile-menu-chevron" aria-hidden="true">
                                <FaChevronRight />
                            </span>
                        </Link>
                    </div>

                    <div className="mobile-menu-section">
                        <span className="mobile-menu-group-label">PREFERENCES</span>

                        <Link
                            to="/notification-preferences"
                            className={`mobile-menu-item ${isRouteActive('/notification-preferences') ? 'active-menu-item' : ''}`}
                            onClick={() => setIsSettingsOpen(false)}
                        >
                            <div className="mobile-menu-item-content">
                                <div className="mobile-menu-icon-box">
                                    <FaBell className="mobile-menu-item-icon" />
                                </div>
                                <div className="mobile-menu-item-texts">
                                    <span className="mobile-menu-item-title">Notifications</span>
                                    <span className="mobile-menu-item-desc">Expense reminders and alerts</span>
                                </div>
                            </div>
                            <span className="mobile-menu-chevron" aria-hidden="true">
                                <FaChevronRight />
                            </span>
                        </Link>

                        <Link
                            to="/sia-settings"
                            className={`mobile-menu-item ${isRouteActive('/sia-settings') ? 'active-menu-item' : ''}`}
                            onClick={() => setIsSettingsOpen(false)}
                        >
                            <div className="mobile-menu-item-content">
                                <div className="mobile-menu-icon-box">
                                    <FaRobot className="mobile-menu-item-icon" />
                                </div>
                                <div className="mobile-menu-item-texts">
                                    <span className="mobile-menu-item-title">SIA Settings</span>
                                    <span className="mobile-menu-item-desc">AI assistant preferences</span>
                                </div>
                            </div>
                            <span className="mobile-menu-chevron" aria-hidden="true">
                                <FaChevronRight />
                            </span>
                        </Link>
                    </div>
                </nav>

                <div className="mobile-menu-footer">
                    <button
                        type="button"
                        className="mobile-menu-logout-btn"
                        onClick={() => {
                            setIsSettingsOpen(false);
                            handleLogout();
                        }}
                    >
                        <div className="mobile-menu-logout-left">
                            <div className="mobile-menu-logout-icon-box">
                                <FaSignOutAlt className="mobile-menu-item-icon" />
                            </div>
                            <div className="mobile-menu-item-texts">
                                <span className="mobile-menu-item-title">Logout</span>
                                <span className="mobile-menu-item-desc">Sign out of your account</span>
                            </div>
                        </div>
                        <span className="mobile-menu-chevron" aria-hidden="true">
                            <FaChevronRight />
                        </span>
                    </button>
                </div>
            </div>
        </aside>
    );

    return (
        <>
            <div className={`app-container ${theme} ${confirmDeleteId ? 'blur-background' : ''}`}>

                    <div className={`app-shell ${isSidebarCollapsed ? 'sidebar-collapsed' : ''}`}>

                        {/* UI-REDESIGN desktop-header-sidebar -- desktop-only sidebar.
                            Hidden via CSS at <=600px, exactly like the row it replaces
                            (.desktop-header) was; mobile keeps its own separate header/
                            bottom-nav/settings-drawer below, untouched. */}
                        <aside className="app-sidebar" aria-label="Primary" onScroll={updateChartsCoords}>
                            <div className="sidebar-brand-row">
                                <div className="sidebar-brand">
                                    <img src={theme === "dark-theme" ? appLogoDark : appLogoPink} alt="Balensia logo" className="sidebar-brand-mark" />
                                    <div className="sidebar-brand-text">
                                        <span className="sidebar-brand-name">Balensia</span>
                                        <span className="sidebar-brand-tagline">Track • Plan • Save</span>
                                    </div>
                                </div>

                                <button
                                    type="button"
                                    className="sidebar-collapse-btn"
                                    onClick={() => setIsSidebarCollapsed((prev) => !prev)}
                                    aria-label={isSidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
                                    title={isSidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
                                >
                                    {isSidebarCollapsed ? <FaAngleDoubleRight /> : <FaAngleDoubleLeft />}
                                </button>
                            </div>

                            <nav className="sidebar-nav">
                                <div className="sidebar-group">
                                    <span className="sidebar-group-label">Main</span>

                                    <Link
                                        className={`sidebar-link ${isRouteActive('/') ? 'sidebar-link-active' : ''}`}
                                        to="/"
                                        title="Expenses"
                                    >
                                        <FaWallet className="sidebar-link-icon" />
                                        <span className="sidebar-link-label">Expenses</span>
                                    </Link>

                                    <Link
                                        className={`sidebar-link ${isRouteActive('/budgets') ? 'sidebar-link-active' : ''}`}
                                        to="/budgets"
                                        title="Budgets"
                                    >
                                        <FaChartPie className="sidebar-link-icon" />
                                        <span className="sidebar-link-label">Budgets</span>
                                    </Link>

                                    <Link
                                        className={`sidebar-link ${isRouteActive('/add') ? 'sidebar-link-active' : ''}`}
                                        to="/add"
                                        title="Add"
                                    >
                                        <FaPlusCircle className="sidebar-link-icon" />
                                        <span className="sidebar-link-label">Add</span>
                                    </Link>
                                </div>

                                <div className="sidebar-group">
                                    <span className="sidebar-group-label">Insights</span>

                                    <div
                                        className="dropdown sidebar-dropdown"
                                        ref={chartsDropdownRef}
                                        onMouseEnter={() => {
                                            prefetchCharts();
                                            updateChartsCoords();
                                        }}
                                        onFocus={() => {
                                            prefetchCharts();
                                            updateChartsCoords();
                                        }}
                                    >
                                        <span
                                            className={`sidebar-link-trigger dropdown-toggle ${isChartsActive ? 'sidebar-link-active' : ''}`}
                                            role="button"
                                            tabIndex={0}
                                            aria-haspopup="true"
                                            aria-expanded={isMobile ? showMobileDropdown : undefined}
                                            title={isSidebarCollapsed ? "Charts" : undefined}
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
                                            <FaChartBar className="sidebar-link-icon" />
                                            <span className="sidebar-link-label">Charts</span>
                                        </span>

                                        {!isMobile && (
                                            <div
                                                className="dropdown-menu sidebar-chart-menu"
                                                style={chartsFlyoutCoords ? {
                                                    top: `${chartsFlyoutCoords.top}px`,
                                                    left: `${chartsFlyoutCoords.left}px`
                                                } : undefined}
                                            >
                                                {renderDropdownLinks()}
                                            </div>
                                        )}
                                    </div>

                                    <Link
                                        className={`sidebar-link ${isRouteActive('/analysis') ? 'sidebar-link-active' : ''}`}
                                        to="/analysis"
                                        title="Analysis"
                                        onMouseEnter={loadInsights}
                                        onFocus={loadInsights}
                                        onTouchStart={loadInsights}
                                    >
                                        <FaSearchDollar className="sidebar-link-icon" />
                                        <span className="sidebar-link-label">Analysis</span>
                                    </Link>
                                </div>

                                <div className="sidebar-group">
                                    <span className="sidebar-group-label">Tools</span>

                                    <Link
                                        className={`sidebar-link ${isRouteActive('/rules') ? 'sidebar-link-active' : ''}`}
                                        to="/rules"
                                        title="Rules"
                                    >
                                        <FaTags className="sidebar-link-icon" />
                                        <span className="sidebar-link-label">Rules</span>
                                    </Link>

                                    <Link
                                        className={`sidebar-link ${isRouteActive('/recurring') ? 'sidebar-link-active' : ''}`}
                                        to="/recurring"
                                        title="Recurring"
                                    >
                                        <FaSyncAlt className="sidebar-link-icon" />
                                        <span className="sidebar-link-label">Recurring</span>
                                    </Link>

                                    <Link
                                        className={`sidebar-link ${isRouteActive('/receipts') ? 'sidebar-link-active' : ''}`}
                                        to="/receipts"
                                        title="Receipts"
                                    >
                                        <FaReceipt className="sidebar-link-icon" />
                                        <span className="sidebar-link-label">Receipts</span>
                                    </Link>

                                    <Link
                                        className={`sidebar-link ${isRouteActive('/data-transfer') || isRouteActive('/import') || isRouteActive('/export') ? 'sidebar-link-active' : ''}`}
                                        to="/data-transfer"
                                        title="Data Transfer"
                                    >
                                        <FaExchangeAlt className="sidebar-link-icon" />
                                        <span className="sidebar-link-label">Data Transfer</span>
                                    </Link>
                                </div>

                            </nav>

                            <button
                                type="button"
                                className="sidebar-logout"
                                onClick={handleLogout}
                                title="Logout"
                            >
                                <FaSignOutAlt className="sidebar-link-icon" />
                                <span className="sidebar-link-label">Logout</span>
                            </button>
                        </aside>

                        <div className="app-content-column">

                            {/* UI-REDESIGN desktop-header-sidebar -- compact desktop top
                                header. Only a theme toggle (existing toggleTheme) and a
                                notification-preferences link are wired here: the reference
                                also shows an "Ask SIA" action and a profile control, but
                                neither has a supported existing app behavior to attach to
                                (see spec/ui-redesign/desktop-header-sidebar.md, findings
                                3-4), so both are omitted rather than faked. Hidden via CSS
                                at <=600px alongside .app-sidebar. */}
                            <div className="app-topbar">
                                <div className="desktop-typewriter">
                                    <p>Track your expenses easily!</p>
                                </div>

                                <div className="app-topbar-controls">
                                    <button
                                        type="button"
                                        className="topbar-theme-toggle"
                                        onClick={toggleTheme}
                                        aria-label={theme === 'light-theme' ? 'Switch to dark mode' : 'Switch to light mode'}
                                    >
                                        <FaSun className={`topbar-theme-icon ${theme === 'light-theme' ? 'topbar-theme-icon-active' : ''}`} />
                                        <FaMoon className={`topbar-theme-icon ${theme === 'dark-theme' ? 'topbar-theme-icon-active' : ''}`} />
                                    </button>

                                    <Link
                                        className={`topbar-icon-btn ${isRouteActive('/sia-settings') ? 'topbar-icon-btn-active' : ''}`}
                                        to="/sia-settings"
                                        aria-label="SIA Settings"
                                        title="SIA Settings"
                                    >
                                        <FaRobot />
                                    </Link>

                                    <Link
                                        className={`topbar-icon-btn ${isRouteActive('/notification-preferences') ? 'topbar-icon-btn-active' : ''}`}
                                        to="/notification-preferences"
                                        aria-label="Notifications"
                                        title="Notifications"
                                    >
                                        <FaBell />
                                    </Link>

                                    {isSidebarCollapsed && (
                                        <button
                                            type="button"
                                            className="topbar-icon-btn topbar-logout-btn"
                                            onClick={handleLogout}
                                            aria-label="Logout"
                                            title="Logout"
                                        >
                                            <FaSignOutAlt />
                                        </button>
                                    )}
                                </div>
                            </div>

                            <header className="app-header">
                                <div className="mobile-header">
                                    <div className="typewriter">
                                        <p>Track your expenses easily!</p>
                                    </div>

                                    <button
                                        type="button"
                                        className="mobile-header-theme-toggle"
                                        onClick={toggleTheme}
                                        aria-label={theme === 'light-theme' ? 'Switch to dark mode' : 'Switch to light mode'}
                                        title={theme === 'light-theme' ? 'Dark Mode' : 'Light Mode'}
                                    >
                                        {theme === 'light-theme' ? <FaMoon aria-hidden="true" /> : <FaSun aria-hidden="true" />}
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
                                        <Route path="/budgets" element={<BudgetsPage />} />
                                        <Route path="/add" element={<Add isEdit={isEdit} setIsEdit={setIsEdit} />} />
                                        <Route path="/chart/line" element={<TrendChartPage />} />
                                        <Route path="/chart/bar" element={<BarChartPage />} />
                                        <Route path="/chart/pie" element={<PieChartPage />} />
                                        <Route path="/analysis" element={<Insights />} />
                                        <Route path="/rules" element={<MerchantRules />} />
                                        <Route path="/recurring" element={<RecurringPage onEditExpense={handleEditFromRecurring} />} />
                                        <Route path="/notification-preferences" element={<NotificationPreferences />} />
                                        <Route path="/sia-settings" element={<SiaPreferences />} />
                                        <Route path="/data-transfer" element={<DataTransfer />} />
                                        <Route path="/export" element={<DataTransfer initialTab="export" />} />
                                        <Route path="/receipts" element={<ReceiptInbox />} />
                                        <Route path="/import" element={<DataTransfer initialTab="import" />} />
                                    </Routes>
                                </Suspense>
                            </main>
                        </div>
                    </div>

                    {isMobile && (
                        <nav className="mobile-bottom-nav" aria-label="Mobile navigation">
                            <Link to="/" className={location.pathname === "/" ? "active-nav" : ""}>
                                <FaWallet />
                                <span>Expenses</span>
                            </Link>

                            <Link to="/budgets" className={location.pathname === "/budgets" ? "active-nav" : ""}>
                                <FaChartPie />
                                <span>Budgets</span>
                            </Link>

                            <Link to="/add" className={location.pathname === "/add" ? "active-nav" : ""}>
                                <FaPlusCircle />
                                <span>Add</span>
                            </Link>

                            <button
                                type="button"
                                className={`mobile-bottom-nav-btn ${isSettingsOpen || (!['/', '/budgets', '/add'].includes(location.pathname)) ? "active-nav" : ""}`}
                                onClick={() => setIsSettingsOpen(true)}
                                aria-label="Settings and Menu"
                                aria-expanded={isSettingsOpen}
                            >
                                <FaCog />
                                <span>Settings</span>
                            </button>
                        </nav>
                    )}

                    {isMobile && showMobileDropdown && (
                        <>
                            <div
                                className="dropdown-overlay mobile-chart-overlay"
                                onClick={() => { setShowMobileDropdown(false); setIsSettingsOpen(false); }}
                            />

                            <div className={`dropdown-menu ${showMobileDropdown ? "mobile-dropdown-modal" : ""}`}>
                                {renderDropdownLinks()}
                            </div>
                        </>
                    )}

                    {isSettingsOpen && (
                        <>
                            <div
                                className="dropdown-overlay settings-overlay"
                                onClick={() => setIsSettingsOpen(false)}
                                aria-hidden="true"
                            />
                            {renderMobileSettings()}
                        </>
                    )}
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
