import { productName } from '../../../electron-builder.json'
import { AccountSwitcher } from './AccountSwitcher'

/** 显示软件名称、图标和直播账号切换入口。 */
export function Header() {
  return (
    <header className="w-full bg-white shadow-xs px-6 flex h-16 items-center justify-between">
      {/* <div className=""> */}
      <div className="flex items-center gap-3">
        <img src="favicon.png" alt="" className="h-7 w-7" />
        <h1 className="text-lg font-semibold text-gray-800 sm:text-xl">{productName}</h1>
      </div>

      <div className="flex items-center">
        <AccountSwitcher />
      </div>
      {/* </div> */}
    </header>
  )
}
