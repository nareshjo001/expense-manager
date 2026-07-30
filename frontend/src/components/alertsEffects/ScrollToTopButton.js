import { useState, useEffect } from 'react';
import './ScrollToTopButton.css';

// Shows a button that scrolls smoothly to the top once the page is scrolled down 300px.
export default function ScrollToTopButton() {
  const [showButton, setShowButton] = useState(false);

  useEffect(() => {
    const checkScrollTop = () => {
      setShowButton(window.scrollY > 300);
    };

    window.addEventListener('scroll', checkScrollTop);

    return () => window.removeEventListener('scroll', checkScrollTop);
  }, []);

  const scrollToTop = () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return showButton ? (
    <button
      className="scroll-top-btn"
      onClick={scrollToTop}
      style={{ zIndex: 99999 }}
    >
      ↑ Top
    </button>
  ) : null;
}