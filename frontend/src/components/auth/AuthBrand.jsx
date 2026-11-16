import { NavLink } from 'react-router-dom'
import Logo from '../Logo'

function AuthBrand() {
  return (
    <NavLink to="/login" className="mb-8 flex items-center gap-3 lg:hidden">
      <Logo size={40} iconSize={22} />
      <span className="text-sm font-bold leading-tight text-[#eef1f8]">DevNexus AI<span className="block text-xs font-normal text-[#8f99b0]">Software workspace</span></span>
    </NavLink>
  )
}

export default AuthBrand
