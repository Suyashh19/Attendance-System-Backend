const { Resend } = require("resend");

// Fallback just in case env is missing so it won't crash during init
const resend = new Resend(process.env.RESEND_API_KEY || "missing_key");

const sendOtpEmail = async (to, otp) => {
  if (!process.env.RESEND_API_KEY) {
    console.warn("[WARNING] RESEND_API_KEY is not configured. OTP will not be sent to:", to);
    console.log(`[SIMULATED EMAIL] To: ${to} | OTP: ${otp}`);
    return;
  }
  
  console.log(`[DEBUG] RESEND_API_KEY is present in environment variables.`);

  try {
    console.log(`[DEBUG] Executing resend.emails.send() for: ${to}`);
    const result = await resend.emails.send({
      from: "Attendance App <noreply@mail.liveattend.me>",
      to,
      subject: "Your OTP Code",
      html: `<p>Your OTP is <b>${otp}</b>. It expires in 5 minutes.</p>`,
    });
    console.log(`[DEBUG] resend.emails.send() completed successfully. Result:`, result);
  } catch (error) {
    console.error(`[ERROR] resend.emails.send() failed for ${to}:`, error);
    throw new Error("Failed to send email");
  }
};

module.exports = {
  sendOtpEmail,
};
