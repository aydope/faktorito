const mongoose = require("mongoose");

exports.clearUserSessions = async (userId, username) => {
  try {
    const sessionCollection = mongoose.connection.db.collection("sessions");
    const result = await sessionCollection.deleteMany({
      "session.user.id": userId.toString(),
    });
    if (result.deletedCount > 0) {
      console.log(`${result.deletedCount} sessions cleared for ${username}`);
    }
    return result.deletedCount;
  } catch (error) {
    console.error("Session cleanup error:", error);
    return 0;
  }
};
