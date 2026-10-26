import React, { createContext, useState, useEffect } from 'react';

// Global theme context to allow light/dark toggle across app
export const ThemeContext = createContext();

export const ThemeProvider = ({ children }) => {
    const [theme, setTheme] = useState(() => {
        return localStorage.getItem('theme') || 'light-theme';
    });

    const toggleTheme = (event) => {
        const nextTheme = theme === 'light-theme' ? 'dark-theme' : 'light-theme';

        // Check for reduced motion preference
        const prefersReducedMotion =
            typeof window !== 'undefined' &&
            window.matchMedia &&
            window.matchMedia('(prefers-reduced-motion: reduce)').matches;

        // If View Transitions API is not available or reduced motion is preferred
        if (
            typeof document === 'undefined' ||
            !document.startViewTransition ||
            prefersReducedMotion
        ) {
            if (typeof document !== 'undefined' && !prefersReducedMotion) {
                // Smooth fallback transition for browsers without View Transition API
                document.documentElement.classList.add('theme-transitioning');
                setTimeout(() => {
                    document.documentElement.classList.remove('theme-transitioning');
                }, 350);
            }
            setTheme(nextTheme);
            return;
        }

        // Determine the origin coordinates of the toggle trigger (button click or center)
        let x = window.innerWidth / 2;
        let y = window.innerHeight / 2;

        if (event) {
            if (typeof event.clientX === 'number' && typeof event.clientY === 'number' && (event.clientX !== 0 || event.clientY !== 0)) {
                x = event.clientX;
                y = event.clientY;
            } else if (event.currentTarget && typeof event.currentTarget.getBoundingClientRect === 'function') {
                const rect = event.currentTarget.getBoundingClientRect();
                x = rect.left + rect.width / 2;
                y = rect.top + rect.height / 2;
            }
        }

        // Calculate maximum distance to the furthest screen corner
        const endRadius = Math.hypot(
            Math.max(x, window.innerWidth - x),
            Math.max(y, window.innerHeight - y)
        );

        // Native View Transition with circular reveal
        const transition = document.startViewTransition(() => {
            document.documentElement.classList.remove('light-theme', 'dark-theme');
            document.documentElement.classList.add(nextTheme);
            document.body.classList.remove('light-theme', 'dark-theme');
            document.body.classList.add(nextTheme);
            setTheme(nextTheme);
        });

        transition.ready.then(() => {
            document.documentElement.animate(
                {
                    clipPath: [
                        `circle(0px at ${x}px ${y}px)`,
                        `circle(${endRadius}px at ${x}px ${y}px)`
                    ]
                },
                {
                    duration: 450,
                    easing: 'cubic-bezier(0.2, 0, 0, 1)',
                    pseudoElement: '::view-transition-new(root)'
                }
            );
        }).catch(() => {
            // Silently fallback if transition is aborted or fails
        });
    };

    useEffect(() => {
        localStorage.setItem('theme', theme);
        if (typeof document !== 'undefined') {
            document.documentElement.classList.remove('light-theme', 'dark-theme');
            document.documentElement.classList.add(theme);
            document.body.classList.remove('light-theme', 'dark-theme');
            document.body.classList.add(theme);
        }
    }, [theme]);

    return (
        <ThemeContext.Provider value={{ theme, toggleTheme }}>
            {children}
        </ThemeContext.Provider>
    );
};