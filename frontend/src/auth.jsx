import { createContext, useContext, useEffect, useState } from 'react';
import { api } from './api';

const Ctx = createContext(null);
export const useAuth = () => useContext(Ctx);

export function AuthProvider({ children }) {
  const [usuario, setUsuario] = useState(undefined); // undefined = cargando

  useEffect(() => {
    api('/auth/me').then(setUsuario).catch(() => setUsuario(null));
  }, []);

  const login = async (email, password) =>
    setUsuario(await api('/auth/login', { metodo: 'POST', cuerpo: { email, password } }));
  const logout = async () => {
    await api('/auth/logout', { metodo: 'POST' });
    setUsuario(null);
  };

  return <Ctx.Provider value={{ usuario, login, logout, actualizarUsuario: setUsuario }}>{children}</Ctx.Provider>;
}
