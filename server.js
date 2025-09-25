require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const bodyParser = require('body-parser');
const path = require('path');
const nodemailer = require('nodemailer');
const axios = require('axios');
const app = express();
app.use(bodyParser.json());
const cors = require("cors");
app.use(cors({ origin: "*" }));

// Serve all static files (CSS, JS, images)
app.use(express.static(__dirname)); 
app.use('/css', express.static(path.join(__dirname, 'css')));
app.use('/js', express.static(path.join(__dirname, 'js')));
app.use('/images', express.static(path.join(__dirname, 'images')));

mongoose.connect(
  'mongodb+srv://ktaofeek015:974jdAgrFp7NLdto@cluster0.cc7tsop.mongodb.net/RescureNEAR?retryWrites=true&w=majority&appName=Cluster0',
  {
    useNewUrlParser: true,
    useUnifiedTopology: true
  }
)
.then(() => console.log("MongoDB Atlas connected"))
.catch(err => console.error("MongoDB connection error:", err));


const userSchema = new mongoose.Schema({
  email: String,
  phone: String,
  otp: String,
  otpExpires: Date,
  hasPaid: { type: Boolean, default: false },  
  paystackRef: String 
});
const User = mongoose.model('User', userSchema);

// Nodemailer transporter
const transporter = nodemailer.createTransport({
  host: process.env.EMAIL_HOST,
  port: parseInt(process.env.EMAIL_PORT),
  secure: process.env.EMAIL_PORT == 465,
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});

//  Using Test transporter
transporter.verify((error, success) => {
  if(error) console.error("SMTP connection error:", error);
  else console.log(" SMTP Ready");
});

// Send OTP
async function sendEmailOTP(email, otp){
  await transporter.sendMail({
    from: process.env.EMAIL_FROM,
    to: email,
    subject: "Your OTP Code",
    text: `Your 4-digit OTP code is: ${otp}`,
    html: `<p>Your 4-digit OTP code is: <b>${otp}</b></p>`
  });
  console.log(` OTP sent to ${email}`);
}

// put these near the other mongoose schemas/models
const patientSchema = new mongoose.Schema({
  fullname: String,
  age: Number,
  location: String,
  condition: String,
  createdAt: { type: Date, default: Date.now }
});
const Patient = mongoose.model('Patient', patientSchema);

// Add this route (before your app.listen)
app.post('/api/patient', async (req, res) => {
  try {
    console.log("POST /api/patient body:", req.body); // <--- helpful logging
    const { fullname, age, location, condition } = req.body;
    if (!fullname || !age || !location || !condition) {
      return res.status(400).json({ success: false, message: "Missing fields" });
    }
    const newPatient = new Patient({ fullname, age, location, condition });
    await newPatient.save();
    return res.json({ success: true, message: "Patient registered successfully" });
  } catch (err) {
    console.error(" Patient save error:", err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
});

app.get('/api/patient/latest', async (req, res) => {
  try {
    const patient = await Patient.findOne().sort({ createdAt: -1 }); // last registered
    if (!patient) {
      return res.json({ success: false, message: "No patient found" });
    }
    res.json({ success: true, patient });
  } catch (err) {
    console.error("Fetch patient error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
})

// ================= Routes =================

// Serve slide.html at root
app.get('/', (req,res) => res.sendFile(path.join(__dirname,'slide.html')));

// Signup
app.post('/api/signup', async (req,res)=>{
  const {email, phone} = req.body;
  if(!email || !phone) return res.json({success:false,message:'Missing fields'});

  const exists = await User.findOne({phone});
  if(exists) return res.json({success:false,message:'Phone already registered'});

  const otp = Math.floor(1000+Math.random()*9000).toString();
  const user = new User({email,phone,otp,otpExpires:new Date(Date.now()+5*60*1000)});
  await user.save();

  try{
    await sendEmailOTP(email, otp);
    res.json({success:true,message:'Signup successful! OTP sent to email.'});
  }catch(err){
    console.error(" OTP send error:", err);
    res.json({success:false,message:'Failed to send OTP'});
  }
});

// Verify OTP
app.post('/api/verify', async (req,res)=>{
  const {phone, otp} = req.body;
  const user = await User.findOne({phone});
  if(!user) return res.json({success:false,message:'User not found'});

  if(user.otp === otp && user.otpExpires > Date.now()){
    user.otp = null;
    user.otpExpires = null;
    await user.save();
    return res.json({success:true,message:'OTP verified'});
  } else {
    return res.json({success:false,message:'Invalid or expired OTP'});
  }
});

// Login
app.post('/api/login', async (req,res)=>{
  const {phone} = req.body;
  const user = await User.findOne({phone});
  if(!user) return res.json({success:false,message:'Phone not found'});

  const otp = Math.floor(1000+Math.random()*9000).toString();
  user.otp = otp;
  user.otpExpires = new Date(Date.now()+5*60*1000);
  await user.save();

  try{
    await sendEmailOTP(user.email, otp);
    res.json({success:true,message:'OTP sent to your email'});
  }catch(err){
    console.error(" OTP send error:", err);
    res.json({success:false,message:'Failed to send OTP'});
  }
});


app.post('/api/verify-payment', async (req, res) => {
  const { reference, phone } = req.body; 

  try {
    const response = await axios.get(`https://api.paystack.co/transaction/verify/${reference}`, {
      headers: {
        Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`  
      }
    });

    if (response.data.data.status === "success") {
      await User.updateOne(
        { phone },
        { $set: { hasPaid: true, paystackRef: reference } }
      );

      return res.json({ success: true, message: "Payment verified" });
    } else {
      return res.json({ success: false, message: "Payment not successful" });
    }
  } catch (error) {
    console.error(" Paystack verify error:", error.response?.data || error.message);
    res.status(500).json({ success: false, message: "Verification failed" });
  }
});



// Serve slide.html at root
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'slide.html'));
});


// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, ()=>console.log(` Server running at http://localhost:${PORT}`));
