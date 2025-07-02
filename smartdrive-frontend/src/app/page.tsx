"use client"
import { useState } from "react"
// import { registerWithEmail, loginWithEmail } from "@/lib/auth"
import LogIn from '../components/LogIn';
import SignUp from '../components/SignUp';
import "react-toastify/dist/ReactToastify.css";
import { LampDemo } from "@/components/WebEffect";

function Home() {
  const [isLogin, setIsLogin] = useState(true)
  // const [error, setError] = useState("")
  // const [data, setData] = useState({
  //   firstname: "",
  //   lastname: "",
  //   email: "",
  //   password: "",
  //   re_password: "",
  //   phone: ""
  // })


  // const handleSubmit = async (e: React.FormEvent) => {
  //   e.preventDefault()
  //   setError("")
  //   try {
  //     if (isLogin) {
  //       await loginWithEmail(data.email, data.password)
  //       alert("Logged in successfully!")
  //     } else {
  //       await registerWithEmail(data.email, data.password)
  //       alert("Account created!")
  //     }
  //   } catch (err: any) {
  //     setError(err.message)
  //   }
  // }


  // const OnChangeHandler = async (e: React.ChangeEvent<HTMLInputElement>) => {
  //   setData({
  //     ...data,
  //     [e.target.name]: e.target.value
  //   })
  // }

  return (
    <div className="min-h-screen grid grid-cols-1 md:grid-cols-2">
      <div className="bg-gray-100 flex items-center justify-center p-1">
        <LampDemo />
        {/* <div>
          <LampDemo />
          <h1 className="text-4xl font-bold mb-4">Welcome to SmartDrive</h1>
          <p className="text-lg text-gray-600">Smart file storage with AI metadata and search</p>
        </div> */}
      </div>

      <div className={`flex flex-col justify-center items-center text-white transition-all duration-500'

}`}>
        {isLogin ? <LogIn setIsLogin={setIsLogin} /> : <SignUp setIsLogin={setIsLogin} />}
      </div>
    </div>
  );
}


export default Home;
