import { motion, AnimatePresence } from "framer-motion";
import TrendUpIcon from "./TrenUpIcon";
import TrendDownIcon from './TrendDownIcon';
import './inlineExpenseInsight.css';

// Animated inline card showing a single chart insight with a trend icon.
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

// Renders the up/down/none trend icon for a given trend value.
const TrendIcon = ({ trend }) => {
  if (trend === "UP") return <TrendUpIcon size={14} />;
  if (trend === "DOWN") return <TrendDownIcon size={14} />;
  return null;
};

const InlineChartInsight = ({ item = {} }) => {

  if (!item) return null;

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
          <span className="insight-title">Insight</span>
          <span className="insight-header-icon" 
            style={{
                width: "16px",
                display: "inline-flex",
                justifyContent: "center"
            }}
          >
            {item.trend !== "FLAT" && <TrendIcon trend={item.trend} />}
          </span>
        </div>

        <motion.div className="insight-list">
          <motion.div
            className={`insight-item ${severityClassMap[item.severity]}`}
            variants={itemVariants}
          >
            <span className="insight-dot" />
            <p>{item.text}</p>
          </motion.div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
};

export default InlineChartInsight;