import { useState, useEffect } from 'react';
import './ScrollToTopButton.css';

// ScrollToTopButton shows a button that lets the user scroll smoothly to the top of the page.
// It only appears when the user scrolls down beyond a certain point.
export default function ScrollToTopButton() {
  // State to determine whether the button should be visible
  const [showButton, setShowButton] = useState(false);

  useEffect(() => {
    // Function to check if the user has scrolled down 300px or more
    const checkScrollTop = () => {
      setShowButton(window.scrollY > 300);
    };

    // Add scroll event listener when component mounts
    window.addEventListener('scroll', checkScrollTop);

    // Cleanup function to remove listener when component unmounts
    return () => window.removeEventListener('scroll', checkScrollTop);
  }, []);

  // Function to scroll the window to the top smoothly
  const scrollToTop = () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  // Conditionally render the scroll button only if showButton is true
  return showButton ? (
    <button
      className="scroll-top-btn"
      onClick={scrollToTop}
      style={{ zIndex: 99999 }} // Ensure it appears above all other content
    >
      ↑ Top
    </button>
  ) : null;
}