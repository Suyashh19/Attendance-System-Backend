const { Resend } = require("resend");

// Resend is initialized inside the sendOtpEmail function to ensure fresh environment variables

const sendOtpEmail = async (to, otp) => {
  const apiKey = process.env.RESEND_API_KEY;

  if (!apiKey) {
    console.warn("[WARNING] RESEND_API_KEY is not configured. OTP will not be sent to:", to);
    console.log(`[SIMULATED EMAIL] To: ${to} | OTP: ${otp}`);
    return;
  }
  
  // Late initialization to ensure the latest process.env is used
  const resend = new Resend(apiKey);
  const keyPrefix = apiKey.substring(0, 7);
  console.log(`[DEBUG] Initializing Resend with key starting with: ${keyPrefix}... (length: ${apiKey.length})`);

  try {
    console.log(`[DEBUG] Executing resend.emails.send() for: ${to}`);
    const result = await resend.emails.send({
      from: "Attendance App <onboarding@mail.liveattend.me>",
      to,
      subject: "Your OTP Code",
      html: `<p>Your OTP is <b>${otp}</b>. It expires in 5 minutes.</p>`,
    });
    
    // Resend's send() can return an error object rather than throwing in some versions/cases
    if (result.error) {
      console.error(`[ERROR] Resend API returned an error:`, result.error);
      throw new Error(`Resend Error: ${result.error.message}`);
    }

    console.log(`[DEBUG] resend.emails.send() completed successfully. Result:`, result);
  } catch (error) {
    console.error(`[ERROR] resend.emails.send() failed for ${to}:`, error);
    throw new Error(`Failed to send email: ${error.message}`);
  }
};

module.exports = {
  sendOtpEmail,
};
