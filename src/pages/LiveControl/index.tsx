import { Title } from '@/components/common/Title'
import InstructionsCard from './components/InstructionsCard'
import StatusCard from './components/StatusCard'

/** 首先展示连接操作，平台提示和使用说明紧邻控制区。 */
export default function BrowserControl() {
  return (
    <div className="@container mx-auto max-w-7xl space-y-5">
      <Title title="直播控制台" description="连接直播平台，开通直播间互动和语音播报。" />

      <div className="grid items-start gap-4 @min-[850px]:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <StatusCard />
        <InstructionsCard />
      </div>
    </div>
  )
}
