import type { SpeechPacingSettings as PacingConfig } from 'shared/speechPacing'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'

interface Props {
  settings: PacingConfig
  onChange: (patch: Partial<PacingConfig>) => void
}

interface PacingProps extends Props {
  fixedRate?: { value: number; onChange: (value: number) => void }
}

/** 配置常用播报节奏；蓝云关闭动态语速后显示固定倍率。 */
export function SpeechPacingSettings({ settings, onChange, fixedRate }: PacingProps) {
  return (
    <Card className="min-w-0 shadow-none">
      <CardHeader className="p-5 pb-4">
        <CardTitle className="text-base">播报节奏</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 p-5 pt-0">
        <div className="flex items-center justify-between gap-3">
          <Label htmlFor="tts-dynamic-rate">动态语速</Label>
          <Switch
            id="tts-dynamic-rate"
            checked={settings.enabled}
            onCheckedChange={enabled => onChange({ enabled })}
          />
        </div>
        {settings.enabled ? (
          <>
            <div className="grid grid-cols-2 gap-3">
              <div className="min-w-0 space-y-2">
                <Label htmlFor="tts-rate-min" className="flex flex-wrap items-baseline gap-x-2">
                  最低语速 <span className="tabular-nums">{settings.minRate.toFixed(2)}×</span>
                </Label>
                <input
                  id="tts-rate-min"
                  aria-label="最低语速"
                  className="w-full accent-primary"
                  type="range"
                  min={0.5}
                  max={2}
                  step={0.01}
                  value={settings.minRate}
                  onChange={event => {
                    const minRate = Number(event.target.value)
                    onChange({ minRate, maxRate: Math.max(minRate, settings.maxRate) })
                  }}
                />
              </div>
              <div className="min-w-0 space-y-2">
                <Label htmlFor="tts-rate-max" className="flex flex-wrap items-baseline gap-x-2">
                  最高语速 <span className="tabular-nums">{settings.maxRate.toFixed(2)}×</span>
                </Label>
                <input
                  id="tts-rate-max"
                  aria-label="最高语速"
                  className="w-full accent-primary"
                  type="range"
                  min={0.5}
                  max={2}
                  step={0.01}
                  value={settings.maxRate}
                  onChange={event => {
                    const maxRate = Number(event.target.value)
                    onChange({ maxRate, minRate: Math.min(maxRate, settings.minRate) })
                  }}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="tts-pacing-style">整体节奏</Label>
              <Select
                value={settings.style}
                onValueChange={value => onChange({ style: value as PacingConfig['style'] })}
              >
                <SelectTrigger id="tts-pacing-style">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="natural">自然讲解</SelectItem>
                  <SelectItem value="calm">舒缓陪伴</SelectItem>
                  <SelectItem value="energetic">轻快互动</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <p className="text-xs leading-relaxed text-muted-foreground">
              价格和注意事项稍慢，欢迎和互动稍快。
            </p>
          </>
        ) : fixedRate ? (
          <div className="space-y-2">
            <Label htmlFor="lanyun-rate">语速倍率</Label>
            <Input
              id="lanyun-rate"
              type="number"
              min={0.5}
              max={2}
              step={0.1}
              value={fixedRate.value}
              onChange={event => fixedRate.onChange(Number(event.target.value))}
            />
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">按音色原速播放。</p>
        )}
      </CardContent>
    </Card>
  )
}

/** 在朗读细调中保存直播间的额外节奏要求。 */
export function SpeechPacingRequirements({ settings, onChange }: Props) {
  return (
    <div className="space-y-2">
      <Label htmlFor="tts-pacing-requirements">直播间播报要求（选填）</Label>
      <Textarea
        id="tts-pacing-requirements"
        disabled={!settings.enabled}
        value={settings.requirements}
        maxLength={1000}
        placeholder="例如：自习室讲解，安静舒缓，价格讲清楚。"
        onChange={event => onChange({ requirements: event.target.value })}
      />
      <p className="text-xs text-muted-foreground">
        动态语速开启时生效。留空时参考话术的补充要求。
      </p>
    </div>
  )
}
