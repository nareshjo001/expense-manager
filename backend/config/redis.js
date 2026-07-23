const { createClient } = require("redis");

const redisClient = createClient({
  url: process.env.REDIS_URL,
});

redisClient.on("error", (err) => {
  console.error("Redis Error:", err);
});

async function connectRedis() {
  await redisClient.connect();
  console.log("Redis Connected");
}

module.exports = {
  redisClient,
  connectRedis,
};