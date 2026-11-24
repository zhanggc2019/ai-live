import React from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

const instructions = [
  '选择平台并连接，在浏览器中登录对应账号。',
  '完成连接后，进入开播准备选择话术和音色，也可使用当前平台支持的互动功能。',
]

/** 显示连接前后的操作顺序。 */
const InstructionsCard = React.memo(() => (
  <Card className="shadow-none">
    <CardHeader className="px-5 pt-5 pb-4">
      <CardTitle>连接步骤</CardTitle>
    </CardHeader>
    <CardContent className="px-5 pb-5">
      <ol className="list-decimal space-y-2 pl-5 text-sm text-muted-foreground">
        {instructions.map(instruction => (
          <li key={instruction}>{instruction}</li>
        ))}
      </ol>
    </CardContent>
  </Card>
))

export default InstructionsCard
