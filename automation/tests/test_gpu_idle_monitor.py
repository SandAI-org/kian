import copy
import importlib.util
from pathlib import Path
import unittest
from unittest.mock import Mock

spec = importlib.util.spec_from_file_location('gpu_idle_monitor', Path(__file__).parents[1] / 'scripts/gpu_idle_monitor.py')
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


def gpu(index=0, processes=0, memory=0, utilization=0):
    return dict(uuid=f'gpu-{index}', index=str(index), memory_mib=memory,
                utilization=utilization, processes=processes, mig=False)


class TestGpuAvailability(unittest.TestCase):
    def setUp(self):
        self.job = dict(id='fixed-notification-id', status='watching', host='test-host', label='H200',
                        min_free=1, stable_seconds=180, max_memory_mib=256, language='zh')

    def test_utilization_zero_does_not_mean_available(self):
        for cards in [[gpu(processes=1, memory=62000)], [gpu(memory=62000)], [gpu(utilization=30)]]:
            job = copy.deepcopy(self.job)
            for now in [0, 60, 120, 180]:
                self.assertEqual(m.evaluate(job, cards, now), [])

    def test_same_card_must_be_stable_and_flapping_restarts(self):
        for now in [0, 60, 120]:
            self.assertFalse(m.evaluate(self.job, [gpu()], now))
        self.assertTrue(m.evaluate(self.job, [gpu()], 180))
        self.assertFalse(m.evaluate(self.job, [gpu(processes=1)], 240))
        self.assertFalse(m.evaluate(self.job, [gpu()], 300))
        self.assertFalse(m.evaluate(self.job, [gpu()], 360))
        self.assertFalse(m.evaluate(self.job, [gpu()], 420))
        self.assertTrue(m.evaluate(self.job, [gpu()], 480))

    def test_rotating_free_cards_and_sleep_do_not_complete_window(self):
        for now in [0, 60, 120, 180]:
            busy = (now // 60) % 2
            self.assertFalse(m.evaluate(self.job, [gpu(0, processes=int(busy == 0)), gpu(1, processes=int(busy == 1))], now))
        job = copy.deepcopy(self.job)
        self.assertFalse(m.evaluate(job, [gpu(0), gpu(1)], 1000))

    def test_all_threshold_and_incomplete_inventory(self):
        self.job['min_free'] = 'all'
        for now in [0, 60, 120, 180]:
            self.assertFalse(m.evaluate(self.job, [gpu(0), gpu(1, processes=1)], now))
        with self.assertRaises(ValueError):
            m.evaluate(self.job, [gpu(0)], 240)
        for now in [240, 300, 360]:
            self.assertFalse(m.evaluate(self.job, [gpu(0), gpu(1)], now))
        self.assertEqual(len(m.evaluate(self.job, [gpu(0), gpu(1)], 420)), 2)

    def test_delivery_only_once_and_retry_rechecks_gpu(self):
        state = {'jobs': [self.job]}
        persist = Mock()
        sender = Mock(side_effect=TimeoutError())
        for now in [0, 60, 120, 180]:
            m.check_jobs(state, persist, lambda host: [gpu()], sender, now)
        self.assertEqual(self.job['status'], 'watching')
        m.check_jobs(state, persist, lambda host: [gpu(processes=1)], sender, 240)
        self.assertEqual(sender.call_count, 1)
        sender.side_effect = None
        sender.return_value = {'code': 0, 'data': {'message_id': 'sent'}}
        for now in [300, 360, 420, 480, 540]:
            m.check_jobs(state, persist, lambda host: [gpu()], sender, now)
        self.assertEqual(sender.call_count, 2)
        self.assertEqual(sender.call_args.kwargs['message_uuid'], self.job['id'])
        self.assertEqual(self.job['status'], 'notified')

    def test_unavailable_snapshot_resets_stability(self):
        state = {'jobs': [self.job]}
        for now in [0, 60, 120]:
            m.check_jobs(state, Mock(), lambda host: [gpu()], Mock(), now)
        m.check_jobs(state, Mock(), Mock(side_effect=ValueError()), Mock(), 180)
        self.assertEqual(self.job['idle_since'], {})
        self.assertFalse(m.evaluate(self.job, [gpu()], 240))

    def test_xml_includes_graphics_process_and_rejects_unknown_readings(self):
        xml = '''<nvidia_smi_log><attached_gpus>1</attached_gpus><gpu><uuid>u</uuid><minor_number>0</minor_number><fb_memory_usage><used>4 MiB</used></fb_memory_usage><utilization><gpu_util>0 %</gpu_util></utilization><processes><process_info><type>G</type><pid>9</pid></process_info></processes></gpu></nvidia_smi_log>'''
        self.assertEqual(m.parse_snapshot(xml)[0]['processes'], 1)
        with self.assertRaises(ValueError):
            m.parse_snapshot(xml.replace('4 MiB', 'N/A'))
        with self.assertRaises(ValueError):
            m.parse_snapshot(xml.replace('<attached_gpus>1', '<attached_gpus>2'))


if __name__ == '__main__':
    unittest.main()
