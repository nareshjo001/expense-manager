const cron = require("node-cron");
const Notification = require("../models/Notification");
const { sendPush } = require("../Services/push.service");
const { UserModel } = require("../config/Schemas");

// Random messages pool
const INSIGHT_MESSAGES = [

  {
    title: "Where did your money go? 💸",
    message: "Your latest spending analysis is ready."
  },

  {
    title: "Your spending story changed 👀",
    message: "A new pattern has appeared in your expenses."
  },

  {
    title: "AI found something interesting 🤖",
    message: "Your expense patterns have been analyzed."
  },

  {
    title: "How long can your money last? ⏳",
    message: "Your runway forecast has been updated."
  },

  {
    title: "A hidden trend was detected 📈",
    message: "See what's quietly growing in your spending."
  },

  {
    title: "Cash flow update 💰",
    message: "Check your latest balance and runway insights."
  },

  {
    title: "Your balance tells a story 📊",
    message: "Take a look at your latest financial insights."
  },

  {
    title: "Fresh AI insights are ready 🧠",
    message: "See what your spending data reveals."
  }

];

// Prevent same message twice
let lastIndex = -1;

const getRandomInsightMessage = () => {
  let index;

  do {
    index = Math.floor(Math.random() * INSIGHT_MESSAGES.length);
  } while (index === lastIndex);

  lastIndex = index;

  return INSIGHT_MESSAGES[index];
};

// Run once per day at 7 PM
cron.schedule("30 13 * * *", async () => {

  console.log("Insight reminder cron:", new Date());

  try {

    // Optimized query
    const users = await UserModel.find({}, "_id").lean();

    for (const user of users) {

      // Prevent duplicate notification (once per day)
      const startOfDay = new Date();
      startOfDay.setHours(0, 0, 0, 0);

      const alreadySent = await Notification.findOne({
        userId: user._id,
        type: "insight-reminder",
        createdAt: { $gte: startOfDay }
      });

      // if (alreadySent) continue;

      // Pick random message
      const { title, message } = getRandomInsightMessage();

      // Store notification in DB
      const notification = await Notification.create({
        userId: user._id,
        title,
        message,
        type: "insight-reminder",
        route: "/analysis"
      });

      // Send push
      const pushResult = await sendPush(
        user._id.toString(),
        title,
        message,
        "/analysis"
      );

      // Update status
      if (pushResult.success) {
        await Notification.updateOne(
          { _id: notification._id },
          { pushStatus: "sent" }
        );
      } else {
        await Notification.updateOne(
          { _id: notification._id },
          {
            pushStatus: "failed",
            retryCount: 1,
            nextRetryAt: new Date(Date.now() + 5 * 60 * 1000)
          }
        );
      }
    }

  } catch (err) {
    console.error("Insight reminder failed:", err);
  }

});