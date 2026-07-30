import { motion, AnimatePresence } from "framer-motion";
import TrendUpIcon from "./TrenUpIcon";
import './inlineExpenseInsight.css';

// Animated inline card listing spending overview insight items.
const cardVariants = {
  hidden: { opacity: 0, scale: 0.98 },
  visible: {
    opacity: 1,
    scale: 1,
    transition: {
      duration: 0.25,
      ease: "easeOut",
      when: "beforeChildren",
      staggerChildren: 0.1,
    },
  },
  exit: { opacity: 0, scale: 0.98, transition: { duration: 0.2 } },
};

const itemVariants = {
  hidden: { opacity: 0, y: 6 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.2, ease: "easeOut" },
  },
};

const severityClassMap = {
  HIGH: "severity-high",
  MEDIUM: "severity-medium",
  LOW: "severity-low",
};

const InlineExpenseInsight = ({ items = [] }) => {
  const safeItems = Array.isArray(items) ? items : [];

  if (!safeItems.length) return null;

  return (
    <AnimatePresence>
      <motion.div
        className="expense-insights-card"
        variants={cardVariants}
        initial="hidden"
        animate="visible"
        exit="exit"
      >
        <div className="insight-header">
          <span className="insight-icon">
            <TrendUpIcon size={16} />
          </span>
          <span className="insight-title">Spending Overview</span>
        </div>

        <motion.div className="insight-list">
          {safeItems.map((item, idx) => (
            <motion.div
              key={idx}
              className={`insight-item ${severityClassMap[item.severity]}`}
              variants={itemVariants}
            >
              <span className="insight-dot" />
              <p>{item.text}</p>
            </motion.div>
          ))}
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
};

export default InlineExpenseInsight;